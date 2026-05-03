// ============================================================================
// ROUTER: descuentosRoutes.js
// ============================================================================

import express from 'express';
import { query, getClient } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

// ============================================================================
// 1. GET /api/descuentos
// Obtener todos los descuentos del negocio
// Query params: ?is_active=true&type=percentage&category_id=1
// ============================================================================
router.get('/descuentos', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { is_active, type, category_id, applies_to, code } = req.query;
    
    let conditions = [];
    let params = [];
    let paramIndex = 1;

    if (is_active !== undefined) {
      conditions.push(`d.is_active = $${paramIndex++}`);
      params.push(is_active === 'true');
    }

    if (type) {
      conditions.push(`d.type = $${paramIndex++}`);
      params.push(type);
    }

    if (category_id) {
      conditions.push(`d.category_id = $${paramIndex++}`);
      params.push(parseInt(category_id, 10));
    }

    if (applies_to) {
      conditions.push(`d.applies_to = $${paramIndex++}`);
      params.push(applies_to);
    }

    if (code) {
      conditions.push(`d.code = $${paramIndex++}`);
      params.push(code);
    }

    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(' AND ')}` 
      : '';

    const result = await query(
      `SELECT 
         d.*,
         p.name as product_name,
         c.name as category_name,
         (SELECT is_discount_active($1, d.id)) as is_currently_active
       FROM "${schema}".pos_discounts d
       LEFT JOIN "${schema}".products p ON d.product_id = p.id
       LEFT JOIN "${schema}".categories c ON d.category_id = c.id
       ${whereClause}
       ORDER BY d.priority DESC, d.created_at DESC`,
      [schema, ...params]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 2. GET /api/descuentos/:id
// Obtener un descuento específico por ID
// ============================================================================
router.get('/descuentos/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;

    const result = await query(
      `SELECT 
         d.*,
         p.name as product_name,
         c.name as category_name,
         (SELECT is_discount_active($1, d.id)) as is_currently_active
       FROM "${schema}".pos_discounts d
       LEFT JOIN "${schema}".products p ON d.product_id = p.id
       LEFT JOIN "${schema}".categories c ON d.category_id = c.id
       WHERE d.id = $2`,
      [schema, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Descuento no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 3. POST /api/descuentos
// Crear un nuevo descuento
// ============================================================================
router.post('/descuentos', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const {
      name,
      description,
      type,
      value,
      applies_to = 'order',
      product_id,
      category_id,
      min_amount = 0,
      max_discount,
      min_quantity = 1,
      code,
      usage_limit,
      per_user_limit,
      days_of_week,
      start_time,
      end_time,
      start_date,
      end_date,
      stackable = false,
      priority = 0,
      customer_segment = 'all',
      is_active = true
    } = req.body;

    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    if (!type) return res.status(400).json({ error: 'El tipo es requerido' });
    if (value === undefined) return res.status(400).json({ error: 'El valor es requerido' });

    await client.query('BEGIN');

    const insertRes = await client.query(
      `INSERT INTO "${schema}".pos_discounts (
         name, description, type, value, applies_to,
         product_id, category_id, min_amount, max_discount, min_quantity,
         code, usage_limit, per_user_limit,
         days_of_week, start_time, end_time, start_date, end_date,
         stackable, priority, customer_segment, is_active,
         created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       RETURNING *`,
      [
        name,
        description || null,
        type,
        value,
        applies_to,
        product_id || null,
        category_id || null,
        min_amount,
        max_discount || null,
        min_quantity,
        code || null,
        usage_limit || null,
        per_user_limit || null,
        days_of_week || null,
        start_time || null,
        end_time || null,
        start_date || null,
        end_date || null,
        stackable,
        priority,
        customer_segment,
        is_active,
        req.user?.id || null
      ]
    );

    await client.query('COMMIT');

    const businessId = req.user?.businessId;
    if (businessId) {
      emitToBusiness(businessId, 'discount_created', {
        discount: insertRes.rows[0],
        schema,
      });
    }

    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El código de descuento ya existe' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 4. PUT /api/descuentos/:id
// Actualizar un descuento existente
// ============================================================================
router.put('/descuentos/:id', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const updates = req.body;

    await client.query('BEGIN');

    // Verificar que el descuento existe
    const existing = await client.query(
      `SELECT id FROM "${schema}".pos_discounts WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Descuento no encontrado' });
    }

    // Construir SET dinámico
    const allowedFields = [
      'name', 'description', 'type', 'value', 'applies_to',
      'product_id', 'category_id', 'min_amount', 'max_discount', 'min_quantity',
      'code', 'usage_limit', 'per_user_limit',
      'days_of_week', 'start_time', 'end_time', 'start_date', 'end_date',
      'stackable', 'priority', 'customer_segment', 'is_active'
    ];

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = $${paramIndex++}`);
        values.push(updates[field]);
      }
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    if (setClauses.length === 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    const updateRes = await client.query(
      `UPDATE "${schema}".pos_discounts
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    await client.query('COMMIT');

    const businessId = req.user?.businessId;
    if (businessId) {
      emitToBusiness(businessId, 'discount_updated', {
        discount: updateRes.rows[0],
        schema,
      });
    }

    res.json(updateRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El código de descuento ya existe' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 5. DELETE /api/descuentos/:id
// Eliminar un descuento (soft delete o hard delete)
// ============================================================================
router.delete('/descuentos/:id', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { hard_delete = false } = req.query;

    await client.query('BEGIN');

    // Verificar que el descuento existe
    const existing = await client.query(
      `SELECT id FROM "${schema}".pos_discounts WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Descuento no encontrado' });
    }

    if (hard_delete === 'true') {
      // Hard delete - eliminar físicamente
      await client.query(
        `DELETE FROM "${schema}".pos_discounts WHERE id = $1`,
        [id]
      );
    } else {
      // Soft delete - solo desactivar
      await client.query(
        `UPDATE "${schema}".pos_discounts 
         SET is_active = false, updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
    }

    await client.query('COMMIT');

    const businessId = req.user?.businessId;
    if (businessId) {
      emitToBusiness(businessId, 'discount_deleted', {
        id,
        hard_delete: hard_delete === 'true',
        schema,
      });
    }

    res.json({ 
      success: true, 
      message: hard_delete === 'true' ? 'Descuento eliminado' : 'Descuento desactivado',
      id 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 6. POST /api/descuentos/calculate
// Calcular el mejor descuento para un carrito
// ============================================================================
router.post('/descuentos/calculate', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { items, subtotal, customer_id } = req.body;

    if (!items || !subtotal) {
      return res.status(400).json({ error: 'Carrito incompleto' });
    }

    // Obtener todos los descuentos activos
    const discounts = await query(
      `SELECT * FROM "${schema}".pos_discounts 
       WHERE is_active = true
       AND (usage_limit IS NULL OR used_count < usage_limit)
       AND (start_date IS NULL OR start_date <= NOW())
       AND (end_date IS NULL OR end_date >= NOW())
       ORDER BY priority DESC, value DESC`,
      []
    );

    let bestDiscount = null;
    let bestDiscountAmount = 0;

    for (const discount of discounts.rows) {
      // Verificar monto mínimo
      if (discount.min_amount > 0 && subtotal < discount.min_amount) {
        continue;
      }

      // Verificar días de semana
      if (discount.days_of_week && discount.days_of_week.length > 0) {
        const currentDay = new Date().getDay();
        if (!discount.days_of_week.includes(currentDay)) {
          continue;
        }
      }

      // Verificar rango horario
      if (discount.start_time && discount.end_time) {
        const currentTime = new Date().toLocaleTimeString();
        if (currentTime < discount.start_time || currentTime > discount.end_time) {
          continue;
        }
      }

      let discountAmount = 0;

      // Calcular según tipo
      switch (discount.type) {
        case 'percentage':
          let applicableSubtotal = subtotal;
          
          if (discount.applies_to === 'product' && discount.product_id) {
            applicableSubtotal = items
              .filter(item => item.product_id === discount.product_id)
              .reduce((sum, item) => sum + (item.price * item.quantity), 0);
          } else if (discount.applies_to === 'category' && discount.category_id) {
            applicableSubtotal = items
              .filter(item => item.category_id === discount.category_id)
              .reduce((sum, item) => sum + (item.price * item.quantity), 0);
          }
          
          discountAmount = applicableSubtotal * (discount.value / 100);
          break;

        case 'fixed':
          discountAmount = discount.value;
          break;

        case 'buy_x_get_y':
          // Lógica para 2x1
          let freeItems = 0;
          for (const item of items) {
            if (!discount.product_id || item.product_id === discount.product_id) {
              const sets = Math.floor(item.quantity / (discount.min_quantity || 2));
              freeItems += sets;
            }
          }
          if (freeItems > 0 && items.length > 0) {
            const cheapestPrice = Math.min(...items.map(i => i.price));
            discountAmount = freeItems * cheapestPrice;
          }
          break;
      }

      // Aplicar límite máximo
      if (discount.max_discount && discountAmount > discount.max_discount) {
        discountAmount = discount.max_discount;
      }

      if (discountAmount > bestDiscountAmount) {
        bestDiscountAmount = discountAmount;
        bestDiscount = discount;
      }
    }

    res.json({
      discount_amount: bestDiscountAmount,
      final_amount: subtotal - bestDiscountAmount,
      applied_discount: bestDiscount ? {
        id: bestDiscount.id,
        name: bestDiscount.name,
        type: bestDiscount.type,
        value: bestDiscount.value,
        discount_amount: bestDiscountAmount
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 7. POST /api/descuentos/apply-coupon
// Aplicar un cupón específico
// ============================================================================
router.post('/descuentos/apply-coupon', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { code, subtotal } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Código de cupón requerido' });
    }

    const result = await query(
      `SELECT d.* 
       FROM "${schema}".pos_discounts d
       WHERE d.code = $1 
       AND d.is_active = true
       AND (d.usage_limit IS NULL OR d.used_count < d.usage_limit)
       AND (d.start_date IS NULL OR d.start_date <= NOW())
       AND (d.end_date IS NULL OR d.end_date >= NOW())`,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cupón inválido o expirado' });
    }

    const coupon = result.rows[0];

    if (coupon.min_amount > 0 && subtotal < coupon.min_amount) {
      return res.status(400).json({ 
        error: `Monto mínimo de compra: $${coupon.min_amount}` 
      });
    }

    let discountAmount = coupon.type === 'percentage' 
      ? subtotal * (coupon.value / 100)
      : coupon.value;

    if (coupon.max_discount && discountAmount > coupon.max_discount) {
      discountAmount = coupon.max_discount;
    }

    res.json({
      valid: true,
      discount: {
        id: coupon.id,
        name: coupon.name,
        type: coupon.type,
        value: coupon.value,
        discount_amount: discountAmount,
        final_amount: subtotal - discountAmount
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 8. POST /api/descuentos/:id/register-usage
// Registrar uso de un descuento
// ============================================================================
router.post('/descuentos/:id/register-usage', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { order_id, amount, original_subtotal, final_subtotal, coupon_code } = req.body;

    await client.query('BEGIN');

    // Incrementar contador de usos
    await client.query(
      `UPDATE "${schema}".pos_discounts 
       SET used_count = used_count + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    // Registrar en historial
    await client.query(
      `INSERT INTO "${schema}".pos_order_discounts
         (order_id, discount_id, discount_name, discount_type, discount_value,
          amount, original_subtotal, final_subtotal, coupon_code)
       VALUES ($1, $2, (SELECT name FROM "${schema}".pos_discounts WHERE id = $2), 
               (SELECT type FROM "${schema}".pos_discounts WHERE id = $2),
               (SELECT value FROM "${schema}".pos_discounts WHERE id = $2),
               $3, $4, $5, $6)`,
      [order_id, id, amount, original_subtotal, final_subtotal, coupon_code || null]
    );

    await client.query('COMMIT');

    res.json({ success: true, message: 'Uso registrado' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 9. GET /api/descuentos/stats
// Estadísticas de descuentos
// ============================================================================
router.get('/descuentos/stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const stats = await query(
      `SELECT 
         COUNT(*) as total_discounts,
         SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_discounts,
         SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) as inactive_discounts,
         COUNT(DISTINCT type) as discount_types,
         SUM(used_count) as total_uses,
         AVG(value) as avg_value
       FROM "${schema}".pos_discounts`,
      []
    );

    const byType = await query(
      `SELECT 
         type,
         COUNT(*) as count,
         SUM(used_count) as total_uses
       FROM "${schema}".pos_discounts
       GROUP BY type`,
      []
    );

    res.json({
      overview: stats.rows[0],
      by_type: byType.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;