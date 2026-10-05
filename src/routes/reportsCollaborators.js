// src/routes/reportsCollaborators.js
import express from 'express';
import { query as dbQuery } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/reports/collaborators
 * Reporte de ventas por colaborador usando la tabla order_collaborators.
 *
 * Query params:
 *   from             (YYYY-MM-DD) requerido
 *   to               (YYYY-MM-DD) requerido
 *   collaborator_id  (UUID)       opcional — filtra un colaborador específico
 */
router.get('/collaborators', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { from, to, collaborator_id } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'Parámetros "from" y "to" son obligatorios (YYYY-MM-DD)' });
    }

    // ── 1. Desempeño por colaborador ───────────────────────────────
    const collabParams = [from, to];
    let collabWhere = '';
    if (collaborator_id) {
      collabParams.push(collaborator_id);
      collabWhere = `AND u.id = $${collabParams.length}`;
    }

    const collaboratorsRes = await dbQuery(`
      SELECT
        u.id                                            AS collaborator_id,
        u.first_name,
        u.last_name,
        u.email,
        COUNT(DISTINCT oc.order_id)::int                AS orders,
        COALESCE(SUM(po.total), 0)::numeric             AS total_sales,
        COALESCE(AVG(po.total), 0)::numeric             AS ticket_promedio,
        COALESCE(SUM(po.tax_amount), 0)::numeric        AS total_iva,
        COALESCE(SUM(po.discount_amount), 0)::numeric   AS total_discounts,
        MIN(po.created_at)                              AS first_sale,
        MAX(po.created_at)                              AS last_sale,
        COALESCE((
          SELECT SUM(poi.quantity)::int
          FROM "${schema}".pos_order_items poi
          JOIN "${schema}".pos_orders po2 ON po2.id = poi.order_id
          JOIN "${schema}".order_collaborators oc2 ON oc2.order_id = po2.id
          WHERE oc2.collaborator_id = u.id
            AND po2.created_at::date BETWEEN $1 AND $2
            AND po2.status = 'paid'
        ), 0)::int                                       AS items_sold
      FROM "${schema}".order_collaborators oc
      JOIN "${schema}".users      u  ON u.id  = oc.collaborator_id
      JOIN "${schema}".pos_orders po ON po.id = oc.order_id
      WHERE po.created_at::date BETWEEN $1 AND $2
        AND po.status = 'paid'
        ${collabWhere}
      GROUP BY u.id, u.first_name, u.last_name, u.email
      ORDER BY total_sales DESC
    `, collabParams);

    // ── 2. Timeline diaria ─────────────────────────────────────────
    const timelineParams = [from, to];
    let timelineWhere = '';
    if (collaborator_id) {
      timelineParams.push(collaborator_id);
      timelineWhere = `AND oc.collaborator_id = $${timelineParams.length}`;
    }

    const timelineRes = await dbQuery(`
      SELECT
        po.created_at::date                              AS date,
        COUNT(DISTINCT oc.order_id)::int                 AS orders,
        COALESCE(SUM(DISTINCT po.total), 0)::numeric     AS total_sales,
        COUNT(DISTINCT oc.collaborator_id)::int          AS distinct_collaborators,
        CASE
          WHEN COUNT(DISTINCT oc.order_id) > 0
          THEN (SUM(DISTINCT po.total) / COUNT(DISTINCT oc.order_id))::numeric
          ELSE 0
        END                                              AS ticket_promedio
      FROM "${schema}".order_collaborators oc
      JOIN "${schema}".pos_orders po ON po.id = oc.order_id
      WHERE po.created_at::date BETWEEN $1 AND $2
        AND po.status = 'paid'
        ${timelineWhere}
      GROUP BY po.created_at::date
      ORDER BY po.created_at::date ASC
    `, timelineParams);

    // ── 3. Totales generales ───────────────────────────────────────
    const totalsRes = await dbQuery(`
      SELECT
        COALESCE(SUM(sub.total_sales), 0)::numeric        AS total_ventas,
        COALESCE(SUM(sub.orders), 0)::int                 AS total_ordenes,
        COUNT(sub.collaborator_id)::int                   AS total_colaboradores,
        CASE
          WHEN COALESCE(SUM(sub.orders), 0) > 0
          THEN (SUM(sub.total_sales) / SUM(sub.orders))::numeric
          ELSE 0
        END                                              AS ticket_promedio
      FROM (
        SELECT
          oc.collaborator_id,
          COUNT(DISTINCT oc.order_id)::int       AS orders,
          COALESCE(SUM(po.total), 0)::numeric    AS total_sales
        FROM "${schema}".order_collaborators oc
        JOIN "${schema}".pos_orders po ON po.id = oc.order_id
        WHERE po.created_at::date BETWEEN $1 AND $2
          AND po.status = 'paid'
          ${collaborator_id ? `AND oc.collaborator_id = $3` : ''}
        GROUP BY oc.collaborator_id
      ) sub
    `, collaborator_id ? [from, to, collaborator_id] : [from, to]);

    // ── 4. Formatear respuesta ─────────────────────────────────────
    const collaborators = collaboratorsRes.rows.map((r) => ({
      collaborator_id: r.collaborator_id,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      orders: Number(r.orders) || 0,
      items_sold: Number(r.items_sold) || 0,
      total_sales: Number(r.total_sales) || 0,
      ticket_promedio: Number(r.ticket_promedio) || 0,
      total_iva: Number(r.total_iva) || 0,
      total_discounts: Number(r.total_discounts) || 0,
      first_sale: r.first_sale,
      last_sale: r.last_sale,
    }));

    const timeline = timelineRes.rows.map((r) => ({
      date: r.date,
      orders: Number(r.orders) || 0,
      total_sales: Number(r.total_sales) || 0,
      ticket_promedio: Number(r.ticket_promedio) || 0,
      distinct_collaborators: Number(r.distinct_collaborators) || 0,
    }));

    const totalsRow = totalsRes.rows[0] || {};
    const topCollab = collaborators[0];
    const topColaborador = topCollab
      ? `${topCollab.first_name || ''} ${topCollab.last_name || ''}`.trim() || topCollab.email
      : '—';

    return res.json({
      totals: {
        total_ventas: Number(totalsRow.total_ventas) || 0,
        total_ordenes: Number(totalsRow.total_ordenes) || 0,
        total_colaboradores: Number(totalsRow.total_colaboradores) || 0,
        ticket_promedio: Number(totalsRow.ticket_promedio) || 0,
        top_colaborador: topColaborador,
      },
      collaborators,
      timeline,
    });

  } catch (err) {
    console.error('Error en GET /reports/collaborators:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;