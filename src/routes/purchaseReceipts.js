// routes/purchaseReceipts.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// HELPERS
// ============================================================

/**
 * Actualiza o crea el historial de producto-proveedor
 */
async function updateProductSupplierHistory(schema, productId, supplierId, unitCost) {
  // Verificar si existe el registro
  const existing = await query(`
    SELECT id, total_orders, last_unit_cost, last_order_date
    FROM "${schema}".product_supplier_history
    WHERE product_id = $1 AND supplier_id = $2
  `, [productId, supplierId]);

  if (existing.rows.length > 0) {
    // Actualizar existente
    await query(`
      UPDATE "${schema}".product_supplier_history
      SET 
        last_unit_cost = $3,
        last_order_date = CURRENT_TIMESTAMP,
        total_orders = total_orders + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1 AND supplier_id = $2
    `, [productId, supplierId, unitCost]);
  } else {
    // Crear nuevo
    await query(`
      INSERT INTO "${schema}".product_supplier_history (
        product_id,
        supplier_id,
        last_unit_cost,
        last_order_date,
        total_orders
      ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 1)
    `, [productId, supplierId, unitCost]);
  }
}

/**
 * Crea un movimiento de inventario (entrada por compra)
 */
async function createInventoryMovement(schema, productId, quantity, unitCost, receiptId, receiptNumber, productName) {
  await query(`
    INSERT INTO "${schema}".inventory_movements (
      product_id,
      type,
      quantity,
      unit_cost,
      reference_id,
      notes,
      applied
    ) VALUES ($1, 'entrada', $2, $3, $4, $5, true)
  `, [
    productId,
    quantity,
    unitCost,
    receiptId,
    `Recepción #${receiptNumber} - ${productName} (${quantity} unidades)`
  ]);

  // Actualizar stock del producto
  await query(`
    UPDATE "${schema}".products
    SET 
      stock = stock + $1,
      unit_cost = $2,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
  `, [quantity, unitCost, productId]);
}

// ============================================================
// GET /api/purchase-receipts
// Listar todas las recepciones
// ============================================================
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    
    const result = await query(`
      SELECT 
        pr.*,
        po.order_number,
        s.name as supplier_name,
        COUNT(DISTINCT pri.id) as item_count,
        COALESCE(SUM(pri.line_total), 0) as total
      FROM "${schema}".purchase_receipts pr
      LEFT JOIN "${schema}".purchase_orders po ON pr.purchase_order_id = po.id
      LEFT JOIN "${schema}".suppliers s ON pr.supplier_id = s.id
      LEFT JOIN "${schema}".purchase_receipt_items pri ON pr.id = pri.receipt_id
      GROUP BY pr.id, po.order_number, s.name
      ORDER BY pr.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /purchase-receipts:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-receipts/pending
// Órdenes aprobadas pendientes de recibir
// ============================================================
router.get('/pending', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    
    const result = await query(`
      SELECT 
        po.id,
        po.order_number,
        po.created_at,
        COUNT(DISTINCT poi.id) as total_items,
        SUM(CASE WHEN poi.received_qty < poi.quantity THEN 1 ELSE 0 END) as pending_items
      FROM "${schema}".purchase_orders po
      JOIN "${schema}".purchase_order_items poi ON po.id = poi.purchase_order_id
      WHERE po.status = 'approved'
        AND poi.quantity > poi.received_qty
      GROUP BY po.id
      HAVING SUM(CASE WHEN poi.received_qty < poi.quantity THEN 1 ELSE 0 END) > 0
      ORDER BY po.created_at ASC
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /purchase-receipts/pending:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-receipts/:id
// Obtener una recepción con sus items
// ============================================================
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const schema = await getSchemaName(req);
    
    // Obtener la recepción
    const receiptResult = await query(`
      SELECT 
        pr.*,
        po.order_number,
        s.name as supplier_name
      FROM "${schema}".purchase_receipts pr
      LEFT JOIN "${schema}".purchase_orders po ON pr.purchase_order_id = po.id
      LEFT JOIN "${schema}".suppliers s ON pr.supplier_id = s.id
      WHERE pr.id = $1
    `, [id]);
    
    if (receiptResult.rows.length === 0) {
      return res.status(404).json({ error: 'Recepción no encontrada' });
    }
    
    // Obtener items
    const itemsResult = await query(`
      SELECT 
        pri.*,
        p.code as product_code,
        p.barcode
      FROM "${schema}".purchase_receipt_items pri
      LEFT JOIN "${schema}".products p ON pri.product_id = p.id
      WHERE pri.receipt_id = $1
      ORDER BY pri.created_at ASC
    `, [id]);
    
    res.json({
      receipt: receiptResult.rows[0],
      items: itemsResult.rows
    });
  } catch (err) {
    console.error('Error en GET /purchase-receipts/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-receipts/suppliers/:productId
// Obtener proveedores que han vendido un producto
// ============================================================
router.get('/suppliers/:productId', authMiddleware, async (req, res) => {
  try {
    const { productId } = req.params;
    const schema = await getSchemaName(req);
    
    const result = await query(`
      SELECT DISTINCT
        s.id,
        s.name,
        s.tax_id,
        s.phone,
        s.email,
        psh.last_unit_cost,
        psh.total_orders,
        psh.last_order_date
      FROM "${schema}".suppliers s
      JOIN "${schema}".product_supplier_history psh ON s.id = psh.supplier_id
      WHERE psh.product_id = $1
      ORDER BY psh.total_orders DESC, psh.last_order_date DESC
    `, [productId]);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /purchase-receipts/suppliers/:productId:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/purchase-receipts - CON MÚLTIPLES PROVEEDORES
// ============================================================
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { 
      purchase_order_id, 
      supplier_groups, 
      notes 
    } = req.body;
    
    const schema = await getSchemaName(req);
    const userId = req.user.id;
    
    console.log('📦 Recibiendo recepción:', { purchase_order_id, supplier_groups: supplier_groups?.length });
    
    // Validaciones
    if (!purchase_order_id) {
      return res.status(400).json({ error: 'Orden de compra requerida' });
    }
    
    if (!supplier_groups || supplier_groups.length === 0) {
      return res.status(400).json({ error: 'Se requieren grupos de proveedores' });
    }
    
    // Verificar que todos los grupos tengan proveedor y items
    for (const group of supplier_groups) {
      if (!group.supplier_id) {
        return res.status(400).json({ error: 'Todos los grupos deben tener un proveedor asignado' });
      }
      if (!group.items || group.items.length === 0) {
        return res.status(400).json({ error: `El proveedor ${group.supplier_id} no tiene items` });
      }
    }
    
    // Verificar que la orden existe y está aprobada
    const orderCheck = await query(`
      SELECT status, order_number FROM "${schema}".purchase_orders WHERE id = $1
    `, [purchase_order_id]);
    
    if (orderCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    if (orderCheck.rows[0].status !== 'approved') {
      return res.status(400).json({ 
        error: `La orden debe estar aprobada para recibir mercadería. Estado actual: ${orderCheck.rows[0].status}` 
      });
    }
    
    const orderNumber = orderCheck.rows[0].order_number;
    
    // Generar número de recepción (único para todas las recepciones de esta orden)
    const numberResult = await query(`
      SELECT 'RC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
      LPAD(COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM '-(\\d+)$') AS INTEGER)), 0) + 1, 4, '0') as receipt_number
      FROM "${schema}".purchase_receipts
      WHERE receipt_number LIKE 'RC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '%'
    `);
    
    const receiptNumber = numberResult.rows[0].receipt_number;
    
    await query('BEGIN');
    
    const createdReceipts = [];
    const allProcessedItems = [];
    
    // Procesar cada grupo de proveedor
    for (const group of supplier_groups) {
      const { supplier_id, items } = group;
      
      // Verificar que el proveedor existe
      const supplierCheck = await query(`
        SELECT id, name FROM "${schema}".suppliers WHERE id = $1 AND is_active = true
      `, [supplier_id]);
      
      if (supplierCheck.rows.length === 0) {
        throw new Error(`Proveedor ${supplier_id} no encontrado o inactivo`);
      }
      
      const supplierName = supplierCheck.rows[0].name;
      
      // Calcular total del grupo
      const groupTotal = items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0);
      
      // Crear recepción para este proveedor
      const receiptResult = await query(`
        INSERT INTO "${schema}".purchase_receipts (
          receipt_number,
          purchase_order_id,
          supplier_id,
          notes,
          created_by,
          status,
          total
        ) VALUES ($1, $2, $3, $4, $5, 'completed', $6)
        RETURNING *
      `, [
        receiptNumber,
        purchase_order_id,
        supplier_id,
        notes || null,
        userId,
        groupTotal
      ]);
      
      const receipt = receiptResult.rows[0];
      createdReceipts.push(receipt);
      
      console.log(`✅ Recepción creada para ${supplierName}: ${receiptNumber}`);
      
      // Procesar cada item del grupo
      for (const item of items) {
        // Obtener el item de la orden
        const orderItemResult = await query(`
          SELECT 
            poi.*,
            p.id as product_id,
            p.name as product_name,
            p.code as product_code,
            p.unit_cost as default_cost,
            p.barcode
          FROM "${schema}".purchase_order_items poi
          LEFT JOIN "${schema}".products p ON poi.product_id = p.id
          WHERE poi.id = $1
        `, [item.purchase_order_item_id]);
        
        if (orderItemResult.rows.length === 0) {
          throw new Error(`Item de orden ${item.purchase_order_item_id} no encontrado`);
        }
        
        const orderItemData = orderItemResult.rows[0];
        const productId = orderItemData.product_id;
        const productName = orderItemData.product_name || orderItemData.product_name;
        const unitCost = item.unit_cost || orderItemData.default_cost || 0;
        const quantity = item.quantity || 0;
        const lineTotal = quantity * unitCost;
        
        if (!productId) {
          console.warn(`⚠️ Item ${item.purchase_order_item_id} no tiene product_id, saltando...`);
          continue;
        }
        
        // 1. Insertar item en purchase_receipt_items
        const receiptItemResult = await query(`
          INSERT INTO "${schema}".purchase_receipt_items (
            receipt_id,
            purchase_order_item_id,
            product_id,
            product_name,
            quantity,
            unit_cost,
            line_total,
            notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [
          receipt.id,
          item.purchase_order_item_id,
          productId,
          productName,
          quantity,
          unitCost,
          lineTotal,
          item.notes || null
        ]);
        
        const receiptItemId = receiptItemResult.rows[0].id;
        
        // 2. Guardar/actualizar en purchase_order_item_suppliers
        await query(`
          INSERT INTO "${schema}".purchase_order_item_suppliers (
            purchase_order_item_id,
            supplier_id,
            quantity,
            unit_cost,
            line_total,
            received_qty,
            notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (purchase_order_item_id, supplier_id) 
          DO UPDATE SET
            quantity = purchase_order_item_suppliers.quantity + EXCLUDED.quantity,
            received_qty = purchase_order_item_suppliers.received_qty + EXCLUDED.received_qty,
            line_total = purchase_order_item_suppliers.line_total + EXCLUDED.line_total,
            updated_at = CURRENT_TIMESTAMP
        `, [
          item.purchase_order_item_id,
          supplier_id,
          quantity,
          unitCost,
          lineTotal,
          quantity, // received_qty
          `Recepción #${receiptNumber} - ${item.notes || ''}`
        ]);
        
        // 3. Actualizar received_qty en purchase_order_items
        await query(`
          UPDATE "${schema}".purchase_order_items 
          SET received_qty = received_qty + $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [quantity, item.purchase_order_item_id]);
        
        // 4. Actualizar/crear historial de producto-proveedor
        await updateProductSupplierHistory(schema, productId, supplier_id, unitCost);
        
        // 5. Crear movimiento de inventario (ENTRADA)
        await createInventoryMovement(
          schema, 
          productId, 
          quantity, 
          unitCost, 
          receipt.id, 
          receiptNumber, 
          productName
        );
        
        allProcessedItems.push({
          product_id: productId,
          product_name: productName,
          quantity,
          unit_cost: unitCost,
          line_total: lineTotal,
          supplier_id,
          receipt_id: receipt.id
        });
        
        console.log(`  📦 ${quantity}x ${productName} → ${supplierName} ($${unitCost})`);
      }
    }
    
    // 6. Verificar si todos los items de la orden fueron recibidos
    const pendingResult = await query(`
      SELECT COUNT(*) as pending
      FROM "${schema}".purchase_order_items
      WHERE purchase_order_id = $1
        AND quantity > received_qty
    `, [purchase_order_id]);
    
    const pendingCount = parseInt(pendingResult.rows[0].pending);
    
    if (pendingCount === 0) {
      await query(`
        UPDATE "${schema}".purchase_orders 
        SET 
          status = 'received', 
          received_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [purchase_order_id]);
      
      console.log(`✅ Orden #${orderNumber} completada (todos los items recibidos)`);
    } else {
      console.log(`⏳ Orden #${orderNumber}: ${pendingCount} items pendientes por recibir`);
    }
    
    await query('COMMIT');
    
    // Emitir evento de socket para actualizar inventario
    try {
      const businessId = req.headers['x-business-id'] || req.user?.businessId;
      if (businessId && global.io) {
        global.io.to(`business:${businessId}`).emit('data_changed', {
          entity: 'inventory',
          action: 'updated',
          data: { 
            receipts: createdReceipts.length,
            items: allProcessedItems.length
          }
        });
      }
    } catch (socketError) {
      console.warn('⚠️ Error al emitir evento socket:', socketError.message);
    }
    
    res.status(201).json({
      success: true,
      receipts: createdReceipts,
      items_processed: allProcessedItems.length,
      message: `Se crearon ${createdReceipts.length} recepción(es) para ${allProcessedItems.length} items`,
      pending_items: pendingCount
    });
    
  } catch (err) {
    await query('ROLLBACK');
    console.error('❌ Error en POST /purchase-receipts:', err);
    res.status(500).json({ 
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// ============================================================
// DELETE /api/purchase-receipts/:id
// Eliminar una recepción (solo si está en draft)
// ============================================================
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const schema = await getSchemaName(req);
    
    // Verificar que la recepción está en draft
    const checkResult = await query(`
      SELECT status, receipt_number FROM "${schema}".purchase_receipts WHERE id = $1
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Recepción no encontrada' });
    }
    
    if (checkResult.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Solo se pueden eliminar recepciones en borrador' });
    }
    
    // Eliminar items de la recepción (cascade lo hará automáticamente)
    await query(`
      DELETE FROM "${schema}".purchase_receipts WHERE id = $1
    `, [id]);
    
    res.json({ 
      success: true, 
      message: `Recepción ${checkResult.rows[0].receipt_number} eliminada correctamente` 
    });
  } catch (err) {
    console.error('Error en DELETE /purchase-receipts/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-receipts/stats
// Estadísticas de recepciones
// ============================================================
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    
    const result = await query(`
      SELECT 
        COUNT(*) as total_recepciones,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completadas,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) as borradores,
        COALESCE(SUM(total), 0) as total_mercaderia,
        COUNT(DISTINCT supplier_id) as proveedores_activos
      FROM "${schema}".purchase_receipts
    `);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en GET /purchase-receipts/stats:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;