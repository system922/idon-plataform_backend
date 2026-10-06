import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.get('/product-history', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(`
      SELECT
        psh.id,
        psh.product_id,
        psh.supplier_id,
        psh.last_unit_cost,
        psh.last_order_date,
        psh.updated_at,
        psh.total_orders,
        s.name AS supplier_name,
        p.name AS product_name,
        COALESCE(p.code, p.sku, '') AS product_code,
        p.selling_price AS current_sale_price
      FROM "${schema}".product_supplier_history psh
      JOIN "${schema}".suppliers s ON s.id = psh.supplier_id
      JOIN "${schema}".products p ON p.id = psh.product_id
      ORDER BY psh.last_order_date DESC NULLS LAST, s.name, p.name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /suppliers/product-history:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/raw-material-history', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(`
      SELECT
        rmsh.id,
        rmsh.raw_material_id AS product_id,
        rmsh.supplier_id,
        rmsh.last_unit_cost,
        rmsh.last_order_date,
        rmsh.updated_at,
        rmsh.total_orders,
        s.name AS supplier_name,
        rm.name AS product_name,
        COALESCE(rm.code, rm.sku, '') AS product_code,
        NULL::numeric AS current_sale_price
      FROM "${schema}".raw_material_supplier_history rmsh
      JOIN "${schema}".suppliers s ON s.id = rmsh.supplier_id
      JOIN "${schema}".raw_materials rm ON rm.id = rmsh.raw_material_id
      ORDER BY rmsh.last_order_date DESC NULLS LAST, s.name, rm.name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /suppliers/raw-material-history:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/prices', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { supplier_id, product_id, product_type, unit_cost } = req.body;
    const cost = Number(unit_cost);

    if (!supplier_id || !product_id) {
      return res.status(400).json({ error: 'Proveedor y producto son requeridos' });
    }
    if (!Number.isFinite(cost) || cost < 0) {
      return res.status(400).json({ error: 'El precio debe ser un número mayor o igual a 0' });
    }
    if (!['COMMERCIAL', 'MANUFACTURED'].includes(product_type)) {
      return res.status(400).json({ error: 'Tipo de producto no válido' });
    }

    const isRawMaterial = product_type === 'MANUFACTURED';
    const historyTable = isRawMaterial ? 'raw_material_supplier_history' : 'product_supplier_history';
    const itemColumn = isRawMaterial ? 'raw_material_id' : 'product_id';
    const itemTable = isRawMaterial ? 'raw_materials' : 'products';

    const supplierResult = await query(
      `SELECT id FROM "${schema}".suppliers WHERE id = $1 AND is_active = true`,
      [supplier_id]
    );
    if (!supplierResult.rows.length) {
      return res.status(404).json({ error: 'Proveedor no encontrado o inactivo' });
    }

    const itemResult = await query(
      `SELECT id FROM "${schema}".${itemTable} WHERE id = $1 AND is_active = true`,
      [product_id]
    );
    if (!itemResult.rows.length) {
      return res.status(404).json({ error: 'Producto no encontrado o inactivo' });
    }

    const result = await query(`
      INSERT INTO "${schema}".${historyTable} (${itemColumn}, supplier_id, last_unit_cost, total_orders)
      VALUES ($1, $2, $3, 0)
      ON CONFLICT (${itemColumn}, supplier_id)
      DO UPDATE SET last_unit_cost = EXCLUDED.last_unit_cost, updated_at = NOW()
      RETURNING *
    `, [product_id, supplier_id, cost]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en PUT /suppliers/prices:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT * FROM "${schema}".suppliers
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { name, tax_id, contact, phone, email, address } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const { rows } = await query(`
      INSERT INTO "${schema}".suppliers (name, tax_id, contact, phone, email, address)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, tax_id || null, contact || null, phone || null, email || null, address || null]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { name, tax_id, contact, phone, email, address } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const { rows } = await query(`
      UPDATE "${schema}".suppliers
      SET name=$1, tax_id=$2, contact=$3, phone=$4, email=$5, address=$6, updated_at=NOW()
      WHERE id=$7
      RETURNING *
    `, [name, tax_id || null, contact || null, phone || null, email || null, address || null, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      DELETE FROM "${schema}".suppliers WHERE id=$1
      RETURNING id
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    
    res.json({ success: true, message: 'Proveedor eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
