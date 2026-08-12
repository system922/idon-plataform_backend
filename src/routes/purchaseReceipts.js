// routes/purchaseReceipts.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { generateReceiptNumber } from '../utils/orderNumberGenerator.js';

const router = express.Router();

// ============================================================
// HELPERS
// ============================================================

/**
 * Actualiza o crea el historial de producto-proveedor
 */
async function updateProductSupplierHistory(schema, productId, supplierId, unitCost) {
  const existing = await query(`
    SELECT id, total_orders, last_unit_cost, last_order_date
    FROM "${schema}".product_supplier_history
    WHERE product_id = $1 AND supplier_id = $2
  `, [productId, supplierId]);

  if (existing.rows.length > 0) {
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
      JOIN "${schema}".purchase_order_items_comm poi ON po.id = poi.purchase_order_id
      WHERE po.status = 'approved'
        AND poi.quantity > poi.received_qty
      GROUP BY po.id
      HAVING SUM(CASE WHEN poi.received_qty < poi.quantity THEN 1 ELSE 0 END) > 0
      
      UNION ALL
      
      SELECT 
        po.id,
        po.order_number,
        po.created_at,
        COUNT(DISTINCT poi.id) as total_items,
        SUM(CASE WHEN poi.received_qty < poi.quantity THEN 1 ELSE 0 END) as pending_items
      FROM "${schema}".purchase_orders po
      JOIN "${schema}".purchase_order_items_man poi ON po.id = poi.purchase_order_id
      WHERE po.status = 'approved'
        AND poi.quantity > poi.received_qty
      GROUP BY po.id
      HAVING SUM(CASE WHEN poi.received_qty < poi.quantity THEN 1 ELSE 0 END) > 0
      
      ORDER BY created_at ASC
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
// Obtener proveedores para un producto (con fallback a todos)
// ============================================================
router.get('/suppliers/:productId', authMiddleware, async (req, res) => {
  try {
    const { productId } = req.params;
    const schema = await getSchemaName(req);
    
    const historyResult = await query(`
      SELECT 
        s.id,
        s.name,
        s.tax_id,
        s.phone,
        s.email,
        s.is_active,
        psh.last_unit_cost,
        psh.total_orders,
        psh.last_order_date,
        true as has_history
      FROM "${schema}".suppliers s
      INNER JOIN "${schema}".product_supplier_history psh ON s.id = psh.supplier_id
      WHERE psh.product_id = $1
        AND s.is_active = true
      ORDER BY psh.total_orders DESC, psh.last_order_date DESC
    `, [productId]);
    
    if (historyResult.rows.length > 0) {
      return res.json(historyResult.rows);
    }
    
    const allSuppliers = await query(`
      SELECT 
        id,
        name,
        tax_id,
        phone,
        email,
        is_active,
        NULL as last_unit_cost,
        0 as total_orders,
        NULL as last_order_date,
        false as has_history
      FROM "${schema}".suppliers
      WHERE is_active = true
      ORDER BY name ASC
    `);
    
    res.json(allSuppliers.rows);
    
  } catch (err) {
    console.error('Error en GET /purchase-receipts/suppliers/:productId:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PATCH /api/purchase-receipts/:id/status
// Actualizar estado de una recepción (para marcar como pagada)
// ============================================================
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, payment_method, payment_reference, paid_at } = req.body;
    const schema = await getSchemaName(req);
    
    const validStatuses = ['draft', 'completed', 'paid'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Estado no válido. Debe ser: draft, completed o paid' 
      });
    }
    
    const checkResult = await query(`
      SELECT id, receipt_number, status FROM "${schema}".purchase_receipts WHERE id = $1
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Recepción no encontrada' });
    }
    
    const updateFields = ['status = $1'];
    const values = [status];
    let paramIndex = 2;
    
    if (payment_method) {
      updateFields.push(`payment_method = $${paramIndex}`);
      values.push(payment_method);
      paramIndex++;
    }
    
    if (payment_reference) {
      updateFields.push(`payment_reference = $${paramIndex}`);
      values.push(payment_reference);
      paramIndex++;
    }
    
    if (paid_at) {
      updateFields.push(`paid_at = $${paramIndex}`);
      values.push(paid_at);
      paramIndex++;
    }
    
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);
    
    await query(`
      UPDATE "${schema}".purchase_receipts
      SET ${updateFields.join(', ')}
      WHERE id = $${values.length}
    `, values);
    
    const result = await query(`
      SELECT * FROM "${schema}".purchase_receipts WHERE id = $1
    `, [id]);
    
    res.json(result.rows[0]);
    
  } catch (err) {
    console.error('Error en PATCH /purchase-receipts/:id/status:', err);
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
    
    if (!purchase_order_id) {
      return res.status(400).json({ error: 'Orden de compra requerida' });
    }
    
    if (!supplier_groups || supplier_groups.length === 0) {
      return res.status(400).json({ error: 'Se requieren grupos de proveedores' });
    }
    
    for (const group of supplier_groups) {
      if (!group.supplier_id) {
        return res.status(400).json({ error: 'Todos los grupos deben tener un proveedor asignado' });
      }
      if (!group.items || group.items.length === 0) {
        return res.status(400).json({ error: `El proveedor ${group.supplier_id} no tiene items` });
      }
    }
    
    const orderCheck = await query(`
      SELECT status, order_number, order_type FROM "${schema}".purchase_orders WHERE id = $1
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
    const orderType = orderCheck.rows[0].order_type;
    
    // ✅ Generar número de recepción usando el helper
    const receiptNumber = await generateReceiptNumber(schema);
    
    console.log(`📦 Nueva recepción: ${receiptNumber} para orden #${orderNumber}`);
    
    await query('BEGIN');
    
    const createdReceipts = [];
    const allProcessedItems = [];
    
    for (const group of supplier_groups) {
      const { supplier_id, items } = group;
      
      const supplierCheck = await query(`
        SELECT id, name FROM "${schema}".suppliers WHERE id = $1 AND is_active = true
      `, [supplier_id]);
      
      if (supplierCheck.rows.length === 0) {
        throw new Error(`Proveedor ${supplier_id} no encontrado o inactivo`);
      }
      
      const supplierName = supplierCheck.rows[0].name;
      
      const groupTotal = items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0);
      
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
      
      for (const item of items) {
        let orderItemResult;
        let productId;
        let productName;
        let defaultCost = 0;
        let itemCommId = null;
        let itemManId = null;
        
        if (orderType === 'COMMERCIAL') {
          orderItemResult = await query(`
            SELECT 
              poi.*,
              p.id as product_id,
              p.name as product_name,
              p.code as product_code,
              p.unit_cost as default_cost,
              p.barcode
            FROM "${schema}".purchase_order_items_comm poi
            LEFT JOIN "${schema}".products p ON poi.product_id = p.id
            WHERE poi.id = $1
          `, [item.purchase_order_item_id]);
          
          if (orderItemResult.rows.length === 0) {
            throw new Error(`Item de orden ${item.purchase_order_item_id} no encontrado`);
          }
          
          const data = orderItemResult.rows[0];
          productId = data.product_id;
          productName = data.product_name;
          defaultCost = data.default_cost || 0;
          itemCommId = item.purchase_order_item_id;
        } else {
          orderItemResult = await query(`
            SELECT 
              poi.*,
              p.id as product_id,
              p.name as product_name,
              p.code as product_code,
              p.unit_cost as default_cost,
              p.barcode,
              rm.name as raw_material_name,
              rm.code as raw_material_code
            FROM "${schema}".purchase_order_items_man poi
            LEFT JOIN "${schema}".products p ON poi.product_id = p.id
            LEFT JOIN "${schema}".raw_materials rm ON poi.raw_material_id = rm.id
            WHERE poi.id = $1
          `, [item.purchase_order_item_id]);
          
          if (orderItemResult.rows.length === 0) {
            throw new Error(`Item de orden ${item.purchase_order_item_id} no encontrado`);
          }
          
          const data = orderItemResult.rows[0];
          productId = data.raw_material_id;
          productName = data.raw_material_name || data.product_name;
          defaultCost = data.default_cost || 0;
          itemManId = item.purchase_order_item_id;
        }
        
        const unitCost = item.unit_cost || defaultCost || 0;
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
            purchase_order_item_comm_id,
            purchase_order_item_man_id,
            purchase_order_item_supplier_id,
            product_id,
            product_name,
            quantity,
            unit_cost,
            line_total,
            notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `, [
          receipt.id,
          itemCommId,
          itemManId,
          null,
          productId,
          productName,
          quantity,
          unitCost,
          lineTotal,
          item.notes || null
        ]);
        
        const receiptItemId = receiptItemResult.rows[0].id;
        
        // 2. Guardar/actualizar en purchase_order_item_suppliers (CORREGIDO)
        // La tabla tiene UNIQUE (purchase_order_item_id, supplier_id)
        let supplierItemId = null;
        const purchaseOrderItemId = item.purchase_order_item_id;
        
        // Verificar si ya existe un registro para este purchase_order_item_id y supplier_id
        const checkSupplierResult = await query(`
          SELECT id FROM "${schema}".purchase_order_item_suppliers
          WHERE purchase_order_item_id = $1 AND supplier_id = $2
        `, [purchaseOrderItemId, supplier_id]);
        
        if (checkSupplierResult.rows.length > 0) {
          // Actualizar existente (sumar cantidades)
          const updateSupplierResult = await query(`
            UPDATE "${schema}".purchase_order_item_suppliers
            SET 
              quantity = quantity + $1,
              received_qty = received_qty + $2,
              line_total = line_total + $3,
              updated_at = CURRENT_TIMESTAMP
            WHERE purchase_order_item_id = $4 AND supplier_id = $5
            RETURNING id
          `, [
            quantity,
            quantity,
            lineTotal,
            purchaseOrderItemId,
            supplier_id
          ]);
          supplierItemId = updateSupplierResult.rows[0]?.id;
        } else {
          // Insertar nuevo registro
          const insertSupplierResult = await query(`
            INSERT INTO "${schema}".purchase_order_item_suppliers (
              purchase_order_item_id,
              item_comm_id,
              item_man_id,
              supplier_id,
              quantity,
              unit_cost,
              line_total,
              received_qty,
              notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
          `, [
            purchaseOrderItemId,
            itemCommId,
            itemManId,
            supplier_id,
            quantity,
            unitCost,
            lineTotal,
            quantity,
            `Recepción #${receiptNumber} - ${item.notes || ''}`
          ]);
          supplierItemId = insertSupplierResult.rows[0]?.id;
        }
        
        // 3. Actualizar purchase_receipt_items con el supplier_id
        await query(`
          UPDATE "${schema}".purchase_receipt_items
          SET purchase_order_item_supplier_id = $1
          WHERE id = $2
        `, [supplierItemId, receiptItemId]);
        
        // 4. Actualizar received_qty en purchase_order_items
        if (orderType === 'COMMERCIAL') {
          await query(`
            UPDATE "${schema}".purchase_order_items_comm 
            SET received_qty = received_qty + $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `, [quantity, itemCommId]);
        } else {
          await query(`
            UPDATE "${schema}".purchase_order_items_man 
            SET received_qty = received_qty + $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `, [quantity, itemManId]);
        }
        
        // 5. Actualizar/crear historial de producto-proveedor
        await updateProductSupplierHistory(schema, productId, supplier_id, unitCost);
        
        // 6. Crear movimiento de inventario (ENTRADA)
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
    
    // 7. Verificar si todos los items de la orden fueron recibidos
    let pendingCount = 0;
    
    if (orderType === 'COMMERCIAL') {
      const pendingResult = await query(`
        SELECT COUNT(*) as pending
        FROM "${schema}".purchase_order_items_comm
        WHERE purchase_order_id = $1
          AND quantity > received_qty
      `, [purchase_order_id]);
      pendingCount = parseInt(pendingResult.rows[0].pending);
    } else {
      const pendingResult = await query(`
        SELECT COUNT(*) as pending
        FROM "${schema}".purchase_order_items_man
        WHERE purchase_order_id = $1
          AND quantity > received_qty
      `, [purchase_order_id]);
      pendingCount = parseInt(pendingResult.rows[0].pending);
    }
    
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
    
    const checkResult = await query(`
      SELECT status, receipt_number FROM "${schema}".purchase_receipts WHERE id = $1
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Recepción no encontrada' });
    }
    
    if (checkResult.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Solo se pueden eliminar recepciones en borrador' });
    }
    
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