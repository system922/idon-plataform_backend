import express from 'express';
import { query } from '../../config/database.js';

const router = express.Router();

// GET /api/admin/features
router.get('/features', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.*, m.name AS module_name FROM public.features f
       LEFT JOIN public.modules m ON f.module_id = m.id ORDER BY m.sort_order, f.name`
    );
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

// POST /api/admin/features
router.post('/features', async (req, res, next) => {
  try {
    const { code, name, description, module_id, is_premium, is_active } = req.body;
    const { rows } = await query(
      `INSERT INTO public.features (code,name,description,module_id,is_premium,is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [code, name, description||null, module_id, is_premium||false, is_active!==false]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

// PUT /api/admin/features/:id
router.put('/features/:id', async (req, res, next) => {
  try {
    const { name, description, module_id, is_premium, is_active } = req.body;
    const { rows } = await query(
      `UPDATE public.features SET name=$1,description=$2,module_id=$3,is_premium=$4,
       is_active=$5,updated_at=NOW() WHERE id=$6 RETURNING *`,
      [name, description||null, module_id, is_premium||false, is_active!==false, req.params.id]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

// DELETE /api/admin/features/:id
router.delete('/features/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM public.features WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
