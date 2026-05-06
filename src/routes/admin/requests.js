import express from 'express';
import { query, getClient } from '../../config/database.js';
import { provisionBusinessFromRequest } from '../../services/provisioningService.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// GET /api/admin/requests
router.get('/requests', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        brr.id, brr.slug, brr.business_name,
        bt.code AS business_type_code, bt.name AS business_type_name,
        brr.owner_first_name, brr.owner_last_name,
        brr.owner_first_name || ' ' || brr.owner_last_name AS contact_name,
        brr.owner_email, brr.owner_phone, brr.owner_document_number, brr.owner_document_type,
        brr.status, brr.rejection_reason, brr.requested_at, brr.reviewed_at,
        b.id AS business_id,
        (SELECT string_agg(m.code, ',')
         FROM public.business_registration_request_modules brm
         JOIN public.modules m ON brm.module_id = m.id
         WHERE brm.request_id = brr.id) AS requested_modules,
        (SELECT string_agg(f.code, ',')
         FROM public.business_registration_request_features brf
         JOIN public.features f ON brf.feature_id = f.id
         WHERE brf.request_id = brr.id) AS requested_features
      FROM public.business_registration_requests brr
      LEFT JOIN public.business_types bt ON brr.business_type_id = bt.id
      LEFT JOIN public.businesses b ON b.slug = brr.slug
      ORDER BY brr.requested_at DESC
    `);

    const data = result.rows.map(row => ({
      id:                    row.id,
      slug:                  row.slug,
      business_name:         row.business_name,
      business_type_code:    row.business_type_code  || '',
      business_type_name:    row.business_type_name  || '',
      business_id:           row.business_id || null,
      contact_name:          row.contact_name,
      owner_first_name:      row.owner_first_name,
      owner_last_name:       row.owner_last_name,
      owner_email:           row.owner_email,
      owner_phone:           row.owner_phone,
      owner_document_number: row.owner_document_number,
      owner_document_type:   row.owner_document_type,
      status:                row.status,
      rejection_reason:      row.rejection_reason || null,
      requested_at:          row.requested_at,
      reviewed_at:           row.reviewed_at || null,
      requested_modules:     row.requested_modules
                               ? row.requested_modules.split(',').map(m => m.trim()) : [],
      requested_features:    row.requested_features
                               ? row.requested_features.split(',').map(f => f.trim()) : [],
    }));

    res.json({ data, total: data.length });
  } catch (error) {
    logger.error('Error obteniendo solicitudes:', error);
    next(error);
  }
});

// GET /api/admin/pending
router.get('/pending', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT brr.id, brr.slug, brr.business_name,
              brr.owner_first_name, brr.owner_last_name, brr.owner_email,
              brr.owner_document_number, brr.owner_phone, brr.requested_at
       FROM public.business_registration_requests brr
       WHERE brr.status = 'pending'
       ORDER BY brr.requested_at ASC`
    );
    res.json(successResponse(result.rows, 'Pending registrations fetched'));
  } catch (error) {
    logger.error('Error fetching pending:', error);
    next(error);
  }
});

// POST /api/admin/:requestId/approve
router.post('/:requestId/approve', async (req, res, next) => {
  const { requestId } = req.params;
  const { adminId } = req.body;
  logger.info(`[ADMIN] Approve requestId=${requestId}, adminId=${adminId}`);
  try {
    const result = await provisionBusinessFromRequest(requestId, adminId);
    logger.info(`[APPROVE] Provisión exitosa para request: ${requestId}`, result);
    res.json(successResponse(result, 'Business approved and provisioned successfully'));
  } catch (error) {
    logger.error({ err: error }, `[APPROVE] Error en provisión para request ${requestId}`);
    if (error.message?.includes('not found'))
      return res.status(404).json(errorResponse(error.message, 404));
    res.status(500).json(errorResponse('Internal server error', 500, error.message));
  }
});

// POST /api/admin/:requestId/reject
router.post('/:requestId/reject', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { adminId, rejectionReason } = req.body;
    await query(
      `UPDATE public.business_registration_requests
       SET status=$1, reviewed_by=$2, reviewed_at=NOW(), rejection_reason=$3 WHERE id=$4`,
      ['rejected', adminId, rejectionReason, requestId]
    );
    res.json(successResponse(null, 'Registration request rejected'));
  } catch (error) {
    logger.error('Error rejecting registration:', error);
    next(error);
  }
});

// POST /api/admin/requests/:requestId/save-modules
router.post('/requests/:requestId/save-modules', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { moduleIds = [], featureIds = [] } = req.body;

    const { rows } = await query(
      `SELECT id FROM public.business_registration_requests WHERE id = $1`,
      [requestId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Solicitud no encontrada' });

    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM public.business_registration_request_modules WHERE request_id=$1`, [requestId]);
      await client.query(`DELETE FROM public.business_registration_request_features WHERE request_id=$1`, [requestId]);
      for (const moduleId of moduleIds) {
        await client.query(
          `INSERT INTO public.business_registration_request_modules (id, request_id, module_id)
           VALUES (gen_random_uuid(), $1, $2) ON CONFLICT (request_id, module_id) DO NOTHING`,
          [requestId, moduleId]
        );
      }
      for (const featureId of featureIds) {
        await client.query(
          `INSERT INTO public.business_registration_request_features (id, request_id, feature_id)
           VALUES (gen_random_uuid(), $1, $2) ON CONFLICT (request_id, feature_id) DO NOTHING`,
          [requestId, featureId]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true, message: 'Selección guardada correctamente' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error guardando módulos:', error);
    next(error);
  }
});

export default router;
