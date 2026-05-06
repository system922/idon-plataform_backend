import express from 'express';
import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// ── Listado de negocios aprovisionados (selector de la página Roles) ──────────
// GET /api/admin/businesses
router.get('/businesses', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT b.id, b.name, b.slug, b.schema_name, bt.name AS type
      FROM public.businesses b
      JOIN public.business_types bt ON b.business_type_id = bt.id
      WHERE b.is_active = true AND b.schema_name IS NOT NULL
      ORDER BY b.name ASC
    `);
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

// ── Roles globales de plataforma ──────────────────────────────────────────────
// GET /api/admin/roles
router.get('/roles', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM public.roles ORDER BY name');
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

// POST /api/admin/roles
router.post('/roles', async (req, res, next) => {
  try {
    const { code, name, description, is_system } = req.body;
    const { rows } = await query(
      `INSERT INTO public.roles (code,name,description,is_system) VALUES ($1,$2,$3,$4) RETURNING *`,
      [code, name, description||null, is_system||false]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

// PUT /api/admin/roles/:id
router.put('/roles/:id', async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const { rows } = await query(
      'UPDATE public.roles SET name=$1,description=$2,updated_at=NOW() WHERE id=$3 RETURNING *',
      [name, description||null, req.params.id]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

// DELETE /api/admin/roles/:id
router.delete('/roles/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT is_system FROM public.roles WHERE id=$1', [req.params.id]);
    if (rows[0]?.is_system)
      return res.status(400).json({ ok: false, message: 'No se puede eliminar un rol del sistema' });
    await query('DELETE FROM public.roles WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Roles por esquema de negocio (tenant-roles) ───────────────────────────────
// GET /api/admin/tenant-roles?businessId=X
router.get('/tenant-roles', async (req, res, next) => {
  const { businessId } = req.query;
  if (!businessId) return res.status(400).json({ ok: false, message: 'businessId requerido' });
  try {
    const { rows: biz } = await query(
      'SELECT schema_name FROM public.businesses WHERE id=$1 AND is_active=true',
      [businessId]
    );
    if (!biz.length || !biz[0].schema_name)
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado o sin esquema' });
    const schema = biz[0].schema_name;

    const [{ rows: roles }, { rows: mods }, { rows: feats }] = await Promise.all([
      query(`SELECT id, name, description, permissions, created_at FROM "${schema}".roles ORDER BY id ASC`),
      query(`
        SELECT m.id, m.code, m.name, m.icon
        FROM public.business_modules bm
        JOIN public.modules m ON bm.module_id = m.id
        WHERE bm.business_id = $1 AND bm.is_active = true
        ORDER BY m.sort_order ASC
      `, [businessId]),
      query(`
        SELECT f.id, f.code, f.name, f.module_id, f.is_premium
        FROM public.business_features bf
        JOIN public.features f ON bf.feature_id = f.id
        WHERE bf.business_id = $1 AND bf.is_active = true
        ORDER BY f.name ASC
      `, [businessId]),
    ]);

    const modules = mods.map(m => ({ ...m, features: feats.filter(f => f.module_id === m.id) }));
    const parseP  = p => typeof p === 'string' ? JSON.parse(p) : (p ?? []);
    res.json({ ok: true, roles: roles.map(r => ({ ...r, permissions: parseP(r.permissions) })), modules });
  } catch (e) { next(e); }
});

// POST /api/admin/tenant-roles
router.post('/tenant-roles', async (req, res, next) => {
  const { businessId, name, description, permissions } = req.body;
  if (!businessId || !name)
    return res.status(400).json({ ok: false, message: 'businessId y name requeridos' });
  try {
    const { rows: biz } = await query('SELECT schema_name FROM public.businesses WHERE id=$1', [businessId]);
    if (!biz.length || !biz[0].schema_name)
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });
    const schema = biz[0].schema_name;
    const { rows } = await query(
      `INSERT INTO "${schema}".roles (name, description, permissions) VALUES ($1,$2,$3) RETURNING *`,
      [name, description || null, JSON.stringify(permissions || [])]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

// PUT /api/admin/tenant-roles/:id
router.put('/tenant-roles/:id', async (req, res, next) => {
  const { businessId, name, description, permissions } = req.body;
  if (!businessId || !name)
    return res.status(400).json({ ok: false, message: 'businessId y name requeridos' });
  try {
    const { rows: biz } = await query('SELECT schema_name FROM public.businesses WHERE id=$1', [businessId]);
    if (!biz.length || !biz[0].schema_name)
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });
    const schema = biz[0].schema_name;
    const { rows } = await query(
      `UPDATE "${schema}".roles SET name=$1, description=$2, permissions=$3 WHERE id=$4 RETURNING *`,
      [name, description || null, JSON.stringify(permissions || []), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Rol no encontrado' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

// DELETE /api/admin/tenant-roles/:id?businessId=X
router.delete('/tenant-roles/:id', async (req, res, next) => {
  const { businessId } = req.query;
  if (!businessId) return res.status(400).json({ ok: false, message: 'businessId requerido' });
  try {
    const { rows: biz } = await query('SELECT schema_name FROM public.businesses WHERE id=$1', [businessId]);
    if (!biz.length || !biz[0].schema_name)
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });
    const schema = biz[0].schema_name;
    const { rows } = await query(`DELETE FROM "${schema}".roles WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Rol no encontrado' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
