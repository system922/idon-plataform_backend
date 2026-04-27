import { v4 as uuidv4 } from 'uuid';
import { getClient } from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Aprobar y provisionar un negocio desde una solicitud.
 * @param {string} requestId - UUID de business_registration_requests
 * @param {string} adminId   - UUID del admin que aprueba (de public.admin_users)
 */
export const provisionBusinessFromRequest = async (requestId, adminId) => {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1. Cargar la solicitud
    const { rows: reqRows } = await client.query(
      `SELECT brr.*, bt.code AS business_type_code
       FROM public.business_registration_requests brr
       JOIN public.business_types bt ON brr.business_type_id = bt.id
       WHERE brr.id = $1`,
      [requestId]
    );
    if (reqRows.length === 0) throw new Error(`Request not found: ${requestId}`);
    const req = reqRows[0];
    if (req.status !== 'pending') {
      throw new Error(`Request already processed (status: ${req.status})`);
    }

    // 2. Cargar módulos y features seleccionados
    const { rows: modRows } = await client.query(
      `SELECT m.id, m.code
       FROM public.business_registration_request_modules brrm
       JOIN public.modules m ON brrm.module_id = m.id
       WHERE brrm.request_id = $1`,
      [requestId]
    );
    const enabledModuleCodes = modRows.map(m => m.code);

    const { rows: featRows } = await client.query(
      `SELECT f.id, f.code
       FROM public.business_registration_request_features brrf
       JOIN public.features f ON brrf.feature_id = f.id
       WHERE brrf.request_id = $1`,
      [requestId]
    );
    const enabledFeatureCodes = featRows.map(f => f.code);

    // 3. Crear public.businesses
    const businessId = uuidv4();
    const schemaName = `tenant_${req.slug.replace(/-/g, '_')}`;

    await client.query(
      `INSERT INTO public.businesses
         (id, slug, name, business_type_id, schema_name,
          is_active, is_verified, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,TRUE,TRUE,NOW(),NOW())`,
      [businessId, req.slug, req.business_name, req.business_type_id, schemaName]
    );

    // 4. Activar módulos en public.business_modules
    for (const mod of modRows) {
      await client.query(
        `INSERT INTO public.business_modules
           (id, business_id, module_id, is_active, activated_at, created_at, updated_at)
         VALUES ($1,$2,$3,TRUE,NOW(),NOW(),NOW())
         ON CONFLICT (business_id, module_id) DO UPDATE SET is_active=TRUE, activated_at=NOW()`,
        [uuidv4(), businessId, mod.id]
      );
    }

    // 5. Activar features en public.business_features
    for (const feat of featRows) {
      await client.query(
        `INSERT INTO public.business_features
           (id, business_id, feature_id, is_active, activated_at, created_at, updated_at)
         VALUES ($1,$2,$3,TRUE,NOW(),NOW(),NOW())
         ON CONFLICT (business_id, feature_id) DO UPDATE SET is_active=TRUE, activated_at=NOW()`,
        [uuidv4(), businessId, feat.id]
      );
    }

    // 6. Buscar el user_id del solicitante
    const userId = req.user_id;

    // 7. Buscar rol 'manager'
    const { rows: roleRows } = await client.query(
      `SELECT id FROM public.roles WHERE code = 'manager' LIMIT 1`
    );
    if (roleRows.length === 0) throw new Error('Role manager not found in public.roles');
    const roleId = roleRows[0].id;

    // 8. Vincular usuario al negocio como manager/owner
    if (userId) {
      await client.query(
        `INSERT INTO public.business_users
           (id, business_id, user_id, role_id, is_owner,
            accepted_at, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,TRUE,NOW(),TRUE,NOW(),NOW())
         ON CONFLICT (business_id, user_id) DO NOTHING`,
        [uuidv4(), businessId, userId, roleId]
      );
    }

    // 9. Marcar solicitud como aprobada
    await client.query(
      `UPDATE public.business_registration_requests
       SET status = 'approved',
           reviewed_by = $1,
           reviewed_at = NOW(),
           provisioned_at = NOW(),
           provisioned_business_id = $2,
           schema_name = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [adminId, businessId, schemaName, requestId]
    );

    // 10. Crear schema y tablas DENTRO de la transacción para atomicidad
    logger.info(`[PROVISION] Creando schema ${schemaName} con módulos: [${enabledModuleCodes.join(',')}]`);
    const { rows: provRows } = await client.query(
      `SELECT public.provision_business_tenant($1, $2, $3) as result`,
      [requestId, schemaName, enabledModuleCodes]
    );
    const prov = provRows[0]?.result ?? {};
    if (!prov.success) {
      throw new Error(`Schema provision failed: ${prov.error} (hint: ${prov.hint})`);
    }
    logger.info(`[PROVISION] Schema creado — ${prov.tables_created} tablas en ${schemaName}`);

    await client.query('COMMIT');

    logger.info(
      `[PROVISION] Completado — business=${businessId} schema=${schemaName} ` +
      `modules=[${enabledModuleCodes.join(',')}] features=[${enabledFeatureCodes.join(',')}]`
    );

    return {
      businessId,
      schemaName,
      slug: req.slug,
      modulesActivated: enabledModuleCodes,
      featuresActivated: enabledFeatureCodes,
    };

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, code: err?.code, detail: err?.detail, hint: err?.hint }, '[PROVISION] Error — transacción revertida');
    throw err;
  } finally {
    client.release();
  }
};
