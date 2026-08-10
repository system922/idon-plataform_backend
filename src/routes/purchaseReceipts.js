// routes/purchaseReceipts.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

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
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/purchase-receipts
// Crear una nueva recepción de mercadería
// ============================================================
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { 
      purchase_order_id, 
      supplier_id, 
      items, 
      notes 
    } = req.body;
    
    const schema = await getSchemaName(req);
    const userId = req.user.id;
    
    if (!purchase_order_id) {
      return res.status(400).json({ error: 'Orden de compra requerida' });
    }
    
    if (!supplier_id) {
      return res.status(400).json({ error: 'Proveedor requerido' });
    }
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Se requieren items para la recepción' });
    }
    
    // Verificar que la orden existe y está aprobada
    const orderCheck = await query(`
      SELECT status FROM "${schema}".purchase_orders WHERE id = $1
    `, [purchase_order_id]);
    
    if (orderCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    if (orderCheck.rows[0].status !== 'approved') {
      return res.status(400).json({ error: 'La orden debe estar aprobada para recibir mercadería' });
    }
    
    // Generar número de recepción
    const numberResult = await query(`
      SELECT 'RC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
      LPAD(COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM '-(\\d+)$') AS INTEGER)), 0) + 1, 4, '0') as receipt_number
      FROM "${schema}".purchase_receipts
      WHERE receipt_number LIKE 'RC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '%'
    `);
    
    const receiptNumber = numberResult.rows[0].receipt_number;
    
    await query('BEGIN');
    
    // 1. Crear recepción
    const receiptResult = await query(`
      INSERT INTO "${schema}".purchase_receipts (
        receipt_number,
        purchase_order_id,
        supplier_id,
        notes,
        created_by,
        status
      ) VALUES ($1, $2, $3, $4, $5, 'completed')
      RETURNING *
    `, [receiptNumber, purchase_order_id, supplier_id, notes, userId]);
    
    const receipt = receiptResult.rows[0];
    
    // 2. Insertar items recibidos
    for (const item of items) {
      // Obtener el item de la orden
      const orderItem = await query(`
        SELECT 
          poi.*,
          p.unit_cost as default_cost
        FROM "${schema}".purchase_order_items poi
        LEFT JOIN "${schema}".products p ON poi.product_id = p.id
        WHERE poi.id = $1
      `, [item.purchase_order_item_id]);
      
      if (orderItem.rows.length === 0) {
        throw new Error(`Item de orden ${item.purchase_order_item_id} no encontrado`);
      }
      
      const orderItemData = orderItem.rows[0];
      const unitCost = item.unit_cost || orderItemData.default_cost || 0;
      const quantity = item.quantity || 0;
      
      // Insertar item recibido
      await query(`
        INSERT INTO "${schema}".purchase_receipt_items (
          receipt_id,
          purchase_order_item_id,
          purchase_order_item_supplier_id,
          product_id,
          product_name,
          quantity,
          unit_cost,
          line_total,
          notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        receipt.id,
        item.purchase_order_item_id,
        item.purchase_order_item_supplier_id || null,
        orderItemData.product_id,
        orderItemData.product_name,
        quantity,
        unitCost,
        quantity * unitCost,
        item.notes || null
      ]);
      
      // 3. Actualizar received_qty en purchase_order_items
      await query(`
        UPDATE "${schema}".purchase_order_items 
        SET received_qty = received_qty + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [quantity, item.purchase_order_item_id]);
      
      // 4. Actualizar received_qty en purchase_order_item_suppliers
      if (item.purchase_order_item_supplier_id) {
        await query(`
          UPDATE "${schema}".purchase_order_item_suppliers 
          SET received_qty = received_qty + $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [quantity, item.purchase_order_item_supplier_id]);
      }
    }
    
    // 5. Verificar si todos los items fueron recibidos
    const pendingResult = await query(`
      SELECT COUNT(*) as pending
      FROM "${schema}".purchase_order_items
      WHERE purchase_order_id = $1
        AND quantity > received_qty
    `, [purchase_order_id]);
    
    if (parseInt(pendingResult.rows[0].pending) === 0) {
      await query(`
        UPDATE "${schema}".purchase_orders 
        SET status = 'received', 
            received_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [purchase_order_id]);
    }
    
    await query('COMMIT');
    
    res.status(201).json(receipt);
  } catch (err) {
    await query('ROLLBACK');
    res.status(500).json({ error: err.message });
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
      SELECT status FROM "${schema}".purchase_receipts WHERE id = $1
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
    
    res.json({ success: true, message: 'Recepción eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;