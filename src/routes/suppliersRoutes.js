import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

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
