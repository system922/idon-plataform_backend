// routes/rawMaterials.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// ── GET todas las materias primas ──
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT * FROM "${schema}".raw_materials
      WHERE is_active = true
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error en GET /raw-materials:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET materia prima por ID ──
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(
      `SELECT * FROM "${schema}".raw_materials WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Materia prima no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en GET /raw-materials/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST crear materia prima ──
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { code, name, description, unit, stock, min_stock, unit_cost, barcode, sku } = req.body;
    
    if (!code) return res.status(400).json({ error: 'El código es requerido' });
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    if (!unit) return res.status(400).json({ error: 'La unidad es requerida' });
    
    // Verificar que el código no exista
    const existing = await query(
      `SELECT id FROM "${schema}".raw_materials WHERE code = $1`,
      [code]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe una materia prima con este código' });
    }
    
    const result = await query(`
      INSERT INTO "${schema}".raw_materials
        (code, name, description, unit, stock, min_stock, unit_cost, barcode, sku)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [code, name, description || null, unit, stock || 0, min_stock || 0, unit_cost || 0, barcode || null, sku || null]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en POST /raw-materials:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT actualizar materia prima ──
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { code, name, description, unit, stock, min_stock, unit_cost, barcode, sku, is_active } = req.body;
    
    const result = await query(`
      UPDATE "${schema}".raw_materials
      SET 
        code = COALESCE($1, code),
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        unit = COALESCE($4, unit),
        stock = COALESCE($5, stock),
        min_stock = COALESCE($6, min_stock),
        unit_cost = COALESCE($7, unit_cost),
        barcode = COALESCE($8, barcode),
        sku = COALESCE($9, sku),
        is_active = COALESCE($10, is_active),
        updated_at = NOW()
      WHERE id = $11
      RETURNING *
    `, [code, name, description, unit, stock, min_stock, unit_cost, barcode, sku, is_active, req.params.id]);
    
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Materia prima no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en PUT /raw-materials/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE (soft delete) materia prima ──
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      UPDATE "${schema}".raw_materials
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `, [req.params.id]);
    
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Materia prima no encontrada' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error en DELETE /raw-materials/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;