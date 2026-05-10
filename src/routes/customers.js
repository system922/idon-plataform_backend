import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Función auxiliar para verificar si hay facturación electrónica
async function hasEinvoicing(schema) {
  try {
    const tableCheck = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'einvoice_config'
      )`,
      [schema]
    );
    
    if (!tableCheck.rows[0].exists) {
      return false;
    }
    
    const result = await query(
      `SELECT EXISTS (
        SELECT 1 
        FROM "${schema}".einvoice_config 
        WHERE id = 1 
          AND ruc IS NOT NULL 
          AND ruc != ''
          AND razon_social IS NOT NULL 
          AND razon_social != ''
          AND p12_path IS NOT NULL 
          AND p12_path != ''
      ) as is_configured`,
      []
    );
    
    return result.rows[0]?.is_configured || false;
  } catch (error) {
    if (error.code === '42P01') return false;
    console.error('Error checking einvoicing config:', error);
    return false;
  }
}

/**
 * ========================================
 * RUTAS DE CLIENTES
 * ========================================
 */

/**
 * GET /api/customers
 * Lista todos los clientes con sus órdenes/facturas
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { page = 1, limit = 20, search = '', status = 'all' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const useEinvoicing = await hasEinvoicing(schema);

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (search) {
      whereConditions.push(`(c.name ILIKE $${paramIndex} OR c.email ILIKE $${paramIndex} OR c.document_number ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status === 'active') {
      whereConditions.push(`c.is_active = true`);
    } else if (status === 'inactive') {
      whereConditions.push(`c.is_active = false`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Total de registros
    const countResult = await query(
      `SELECT COUNT(*) as total FROM "${schema}".customers c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Subconsultas según el tipo de facturación
    let ordersSubquery = '';
    let spentSubquery = '';
    
    if (useEinvoicing) {
      // Para facturación electrónica: usar customer_ruc (document_number del cliente)
      ordersSubquery = `COALESCE(
        (SELECT COUNT(*) FROM "${schema}".einvoices e 
         WHERE e.customer_ruc = c.document_number AND e.status = 'autorizada'), 
        0
      ) as total_orders`;
      
      spentSubquery = `COALESCE(
        (SELECT SUM(e.total) FROM "${schema}".einvoices e 
         WHERE e.customer_ruc = c.document_number AND e.status = 'autorizada'), 
        0
      ) as total_spent`;
    } else {
      // Para POS: usar customer_id
      ordersSubquery = `COALESCE(
        (SELECT COUNT(*) FROM "${schema}".pos_orders o 
         WHERE o.customer_id = c.id AND o.status = 'paid'), 
        0
      ) as total_orders`;
      
      spentSubquery = `COALESCE(
        (SELECT SUM(o.total) FROM "${schema}".pos_orders o 
         WHERE o.customer_id = c.id AND o.status = 'paid'), 
        0
      ) as total_spent`;
    }

    const result = await query(
      `SELECT 
         c.id, 
         c.name, 
         c.email, 
         c.phone, 
         c.document_type, 
         c.document_number,
         c.address, 
         c.notes, 
         c.is_active, 
         c.created_at, 
         c.updated_at,
         ${ordersSubquery},
         ${spentSubquery}
       FROM "${schema}".customers c
       ${whereClause}
       ORDER BY c.name ASC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      },
      metadata: {
        invoiceSource: useEinvoicing ? 'einvoicing' : 'pos',
        einvoicingConfigured: useEinvoicing
      }
    });
  } catch (err) {
    console.error('Error al listar clientes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/customers/stats
 * Estadísticas de clientes
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const useEinvoicing = await hasEinvoicing(schema);
    
    let customersWithOrdersSubquery = '';
    
    if (useEinvoicing) {
      // Usar customer_ruc para contar clientes únicos con facturas
      customersWithOrdersSubquery = `(
        SELECT COUNT(DISTINCT c.id) 
        FROM "${schema}".customers c
        INNER JOIN "${schema}".einvoices e ON e.customer_ruc = c.document_number
        WHERE e.status = 'autorizada'
      )`;
    } else {
      customersWithOrdersSubquery = `(
        SELECT COUNT(DISTINCT customer_id) 
        FROM "${schema}".pos_orders 
        WHERE customer_id IS NOT NULL AND status = 'paid'
      )`;
    }

    const result = await query(
      `SELECT
         COUNT(*) as total_customers,
         COUNT(CASE WHEN is_active = true THEN 1 END) as active_customers,
         COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_customers,
         COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as new_last_30_days,
         ${customersWithOrdersSubquery} as customers_with_orders
       FROM "${schema}".customers`
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener estadísticas:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/customers/by-document
 * Busca cliente por número de documento
 */
router.get('/by-document', authMiddleware, async (req, res) => {
  try {
    const { document_number } = req.query;
    if (!document_number) return res.status(400).json({ error: 'document_number requerido' });

    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT id, name, email, phone, document_number, document_type, address, notes
       FROM "${schema}".customers
       WHERE document_number = $1
       LIMIT 1`,
      [document_number]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al buscar por documento:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/customers/cedula
 * Busca cliente por cédula
 */
router.get('/cedula', authMiddleware, async (req, res) => {
  try {
    const { cedula } = req.query;
    if (!cedula) return res.status(400).json({ error: 'cedula es requerida' });

    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const cleanCedula = cedula.trim();
    const result = await query(
      `SELECT id, name, email, phone, document_number
       FROM "${schema}".customers
       WHERE TRIM(document_number) = $1`,
      [cleanCedula]
    );

    if (result.rows.length === 0) return res.json([]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al buscar por cédula:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/customers/:id
 * Obtiene un cliente específico con su consumo
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const useEinvoicing = await hasEinvoicing(schema);
    
    let ordersSubquery = '';
    let spentSubquery = '';
    
    if (useEinvoicing) {
      // Usar customer_ruc en lugar de customer_id
      ordersSubquery = `COALESCE(
        (SELECT COUNT(*) FROM "${schema}".einvoices e 
         WHERE e.customer_ruc = c.document_number AND e.status = 'autorizada'), 
        0
      ) as total_orders`;
      
      spentSubquery = `COALESCE(
        (SELECT SUM(e.total) FROM "${schema}".einvoices e 
         WHERE e.customer_ruc = c.document_number AND e.status = 'autorizada'), 
        0
      ) as total_spent`;
    } else {
      ordersSubquery = `COALESCE(
        (SELECT COUNT(*) FROM "${schema}".pos_orders o 
         WHERE o.customer_id = c.id AND o.status = 'paid'), 
        0
      ) as total_orders`;
      
      spentSubquery = `COALESCE(
        (SELECT SUM(o.total) FROM "${schema}".pos_orders o 
         WHERE o.customer_id = c.id AND o.status = 'paid'), 
        0
      ) as total_spent`;
    }

    const result = await query(
      `SELECT 
         c.id, c.name, c.email, c.phone, c.document_type, c.document_number,
         c.address, c.notes, c.is_active, c.created_at, c.updated_at,
         ${ordersSubquery},
         ${spentSubquery}
       FROM "${schema}".customers c
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    res.json({ 
      success: true, 
      data: result.rows[0],
      metadata: {
        invoiceSource: useEinvoicing ? 'einvoicing' : 'pos'
      }
    });
  } catch (err) {
    console.error('Error al obtener cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/customers - Crear cliente
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { nombre, cedula, email, phone, tipo_documento, address, notes } = req.body;

    if (!nombre || !cedula) {
      return res.status(400).json({ success: false, error: 'Nombre y cédula son requeridos' });
    }

    const existing = await query(
      `SELECT id FROM "${schema}".customers WHERE document_number = $1`,
      [cedula]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Ya existe un cliente con este número de documento' });
    }

    const document_type = tipo_documento || (cedula.length === 13 ? 'ruc' : 'cedula');

    const result = await query(
      `INSERT INTO "${schema}".customers
         (name, email, phone, document_number, document_type, address, notes, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
       RETURNING id, name, email, phone, document_number, document_type, address, notes, is_active`,
      [nombre, email || null, phone || null, cedula, document_type, address || null, notes || null]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Cliente creado exitosamente'
    });
  } catch (err) {
    console.error('Error al crear cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/customers/:id - Actualizar cliente
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { nombre, cedula, email, phone, tipo_documento, address, notes, is_active } = req.body;

    const existing = await query(
      `SELECT id FROM "${schema}".customers WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    if (cedula) {
      const duplicate = await query(
        `SELECT id FROM "${schema}".customers WHERE document_number = $1 AND id != $2`,
        [cedula, id]
      );
      if (duplicate.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'Ya existe otro cliente con este número de documento' });
      }
    }

    const document_type = tipo_documento || (cedula?.length === 13 ? 'ruc' : 'cedula');

    const result = await query(
      `UPDATE "${schema}".customers
       SET name = COALESCE($1, name),
           email = $2,
           phone = $3,
           document_number = COALESCE($4, document_number),
           document_type = COALESCE($5, document_type),
           address = $6,
           notes = $7,
           is_active = COALESCE($8, is_active),
           updated_at = NOW()
       WHERE id = $9
       RETURNING id, name, email, phone, document_number, document_type, address, notes, is_active`,
      [nombre, email || null, phone || null, cedula, document_type, address || null, notes || null, is_active, id]
    );

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Cliente actualizado exitosamente'
    });
  } catch (err) {
    console.error('Error al actualizar cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/customers/:id - Eliminar o desactivar cliente
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { permanent = false } = req.query;

    const existing = await query(
      `SELECT id, document_number FROM "${schema}".customers WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    const useEinvoicing = await hasEinvoicing(schema);
    let hasTransactions = false;
    
    if (useEinvoicing) {
      // Usar document_number para buscar en einvoices.customer_ruc
      const documentNumber = existing.rows[0].document_number;
      const invoicesCheck = await query(
        `SELECT COUNT(*) as count FROM "${schema}".einvoices WHERE customer_ruc = $1`,
        [documentNumber]
      );
      hasTransactions = parseInt(invoicesCheck.rows[0].count) > 0;
    } else {
      const ordersCheck = await query(
        `SELECT COUNT(*) as count FROM "${schema}".pos_orders WHERE customer_id = $1`,
        [id]
      );
      hasTransactions = parseInt(ordersCheck.rows[0].count) > 0;
    }

    if (permanent === 'true' && !hasTransactions) {
      await query(`DELETE FROM "${schema}".customers WHERE id = $1`, [id]);
      res.json({ success: true, message: 'Cliente eliminado permanentemente' });
    } else {
      await query(
        `UPDATE "${schema}".customers SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [id]
      );
      res.json({ success: true, message: 'Cliente desactivado exitosamente' });
    }
  } catch (err) {
    console.error('Error al eliminar cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;