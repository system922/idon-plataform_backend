import express from 'express';
import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// GET /api/admin/modules-with-features  (usado en Solicitudes y Clientes)
router.get('/modules-with-features', async (req, res, next) => {
  try {
    const { rows: modules } = await query(
      `SELECT id, code, name, description, icon, price_monthly
       FROM public.modules WHERE is_active = TRUE ORDER BY sort_order, name`
    );
    const { rows: features } = await query(
      `SELECT id, code, name, description, module_id, is_premium
       FROM public.features WHERE is_active = TRUE ORDER BY name`
    );
    const data = modules.map(mod => ({
      ...mod,
      features: features.filter(f => f.module_id === mod.id),
    }));
    res.json({ data });
  } catch (error) {
    logger.error('Error cargando módulos con features:', error);
    next(error);
  }
});

// GET /api/admin/modules
router.get('/modules', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM public.modules ORDER BY sort_order, name`);
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

// POST /api/admin/modules
router.post('/modules', async (req, res, next) => {
  try {
    const { code, name, description, price_monthly, price_annual, icon, sort_order, is_active } = req.body;
    const { rows } = await query(
      `INSERT INTO public.modules (code,name,description,price_monthly,price_annual,icon,sort_order,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [code, name, description||null, price_monthly||0, price_annual||0, icon||null, sort_order||0, is_active!==false]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

// PUT /api/admin/modules/:id
router.put('/modules/:id', async (req, res, next) => {
  try {
    const { name, description, price_monthly, price_annual, icon, sort_order, is_active } = req.body;
    const { rows } = await query(
      `UPDATE public.modules SET name=$1,description=$2,price_monthly=$3,price_annual=$4,
       icon=$5,sort_order=$6,is_active=$7,updated_at=NOW() WHERE id=$8 RETURNING *`,
      [name, description||null, price_monthly||0, price_annual||0, icon||null, sort_order||0, is_active!==false, req.params.id]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

// DELETE /api/admin/modules/:id
router.delete('/modules/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM public.modules WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
