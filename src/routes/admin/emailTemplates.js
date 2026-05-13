import express from 'express';
import { query } from '../../config/database.js';

const router = express.Router();

// GET /api/admin/email-templates
router.get('/email-templates', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT type, label, description, subject, body, variables, is_active, updated_at
       FROM public.email_templates ORDER BY type`
    );
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

// POST /api/admin/email-templates
router.post('/email-templates', async (req, res, next) => {
  try {
    const { type, label, description, subject, body, variables, is_active } = req.body;
    if (!type?.trim() || !label?.trim() || !subject?.trim() || !body?.trim())
      return res.status(400).json({ ok: false, message: 'type, label, subject y body son requeridos' });

    const { rows } = await query(
      `INSERT INTO public.email_templates (type, label, description, subject, body, variables, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING type`,
      [type.trim(), label, description || '', subject, body, variables || [], is_active !== false]
    );
    res.json({ ok: true, message: 'Plantilla creada', data: { type: rows[0].type } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, message: 'Ya existe una plantilla con ese tipo' });
    next(e);
  }
});

// PUT /api/admin/email-templates/:type
router.put('/email-templates/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    const { label, description, subject, body, variables, is_active } = req.body;
    if (!label?.trim() || !subject?.trim() || !body?.trim())
      return res.status(400).json({ ok: false, message: 'label, subject y body son requeridos' });

    const { rows } = await query(
      `UPDATE public.email_templates
       SET label=$1, description=$2, subject=$3, body=$4, variables=$5, is_active=$6, updated_at=NOW()
       WHERE type=$7 RETURNING type`,
      [label, description || '', subject, body, variables || [], is_active !== false, type]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Plantilla no encontrada' });
    res.json({ ok: true, message: 'Plantilla actualizada' });
  } catch (e) { next(e); }
});

// DELETE /api/admin/email-templates/:type
router.delete('/email-templates/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    const { rows } = await query(
      `DELETE FROM public.email_templates WHERE type=$1 RETURNING type`, [type]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Plantilla no encontrada' });
    res.json({ ok: true, message: 'Plantilla eliminada' });
  } catch (e) { next(e); }
});

export default router;
