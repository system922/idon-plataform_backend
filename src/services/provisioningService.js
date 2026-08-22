import { v4 as uuidv4 } from 'uuid';
import { getClient } from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Solo crea el negocio (business) y vincula usuario, sin activar módulos ni crear tablas.
 * Útil para la aprobación sin provisionamiento.
 * @param {string} requestId - UUID de business_registration_requests
 * @param {string} adminId   - UUID del admin que aprueba
 * @returns {Promise<{ businessId: string, schemaName: string, slug: string }>}
 */
export const createBusinessFromRequest = async (requestId, adminId) => {
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

    // 2. Generar businessId y schemaName
    const businessId = uuidv4();
    const schemaName = `tenant_${req.slug.replace(/-/g, '_')}`;

    // Verificar que no exista ya un negocio con el mismo slug/schema
    const { rows: existingBiz } = await client.query(
      `SELECT id FROM public.businesses WHERE slug = $1 OR schema_name = $2 LIMIT 1`,
      [req.slug, schemaName]
    );
    if (existingBiz.length > 0) {
      throw new Error(`Business with slug '${req.slug}' is already provisioned`);
    }

    // 3. Crear public.businesses (sin activar módulos ni features)
    await client.query(
      `INSERT INTO public.businesses
         (id, slug, name, business_type_id, schema_name,
          is_active, is_verified, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,TRUE,TRUE,NOW(),NOW())`,
      [businessId, req.slug, req.business_name, req.business_type_id, schemaName]
    );



    // 4. Buscar el user_id del solicitante
    const userId = req.user_id;

    // 5. Buscar rol 'manager'
    const { rows: roleRows } = await client.query(
      `SELECT id FROM public.roles WHERE code = 'manager' LIMIT 1`
    );
    if (roleRows.length === 0) throw new Error('Role manager not found in public.roles');
    const roleId = roleRows[0].id;

    // 6. Vincular usuario al negocio como manager/owner
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

    // 8. Marcar solicitud como aprobada
    await client.query(
      `UPDATE public.business_registration_requests
       SET status = 'approved',
           reviewed_by = $1,
           reviewed_at = NOW(),
           provisioned_business_id = $2,
           schema_name = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [adminId, businessId, schemaName, requestId]
    );

    await client.query('COMMIT');

    logger.info(
      `[APPROVE] Solicitud ${requestId} aprobada — business=${businessId} schema=${schemaName} (sin módulos ni tablas)`
    );

    return {
      businessId,
      schemaName,
      slug: req.slug,
    };

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, code: err?.code, detail: err?.detail, hint: err?.hint }, '[APPROVE] Error — transacción revertida');
    throw err;
  } finally {
    client.release();
  }
};


/**
 * Crea (o verifica) las tablas del tenant para un negocio existente,
 * basado en los módulos que tiene activos en ese momento.
 * @param {string} businessId - UUID del negocio
 * @returns {Promise<{ success: boolean, schema: string, tablesCreated: number, modules: string[] }>}
 */
export const provisionTenantTables = async (businessId) => {
  const client = await getClient();
  try {
    // 1. Obtener datos del negocio
    const { rows: bizRows } = await client.query(
      `SELECT id, schema_name FROM public.businesses WHERE id = $1`,
      [businessId]
    );
    if (bizRows.length === 0) throw new Error(`Business not found: ${businessId}`);
    const business = bizRows[0];
    if (!business.schema_name) throw new Error(`Business ${businessId} has no schema assigned`);

    // 2. Obtener módulos activos
    const { rows: modRows } = await client.query(
      `SELECT m.code
       FROM public.business_modules bm
       JOIN public.modules m ON bm.module_id = m.id
       WHERE bm.business_id = $1 AND bm.is_active = TRUE`,
      [businessId]
    );
    const moduleCodes = modRows.map(r => r.code);
    if (moduleCodes.length === 0) throw new Error(`Business ${businessId} has no active modules`);

    // 3. Obtener la solicitud asociada (necesaria para provision_business_tenant)
    const { rows: reqRows } = await client.query(
      `SELECT id FROM public.business_registration_requests 
       WHERE provisioned_business_id = $1 AND status = 'approved'`,
      [businessId]
    );
    if (reqRows.length === 0) {
      throw new Error(`No approved request found for business ${businessId}`);
    }
    const requestId = reqRows[0].id;

    // 4. Ejecutar la función SQL (idempotente)
    const { rows: provRows } = await client.query(
      `SELECT public.provision_business_tenant($1, $2, $3) as result`,
      [requestId, business.schema_name, moduleCodes]
    );
    const provResult = provRows[0]?.result;
    if (!provResult || !provResult.success) {
      throw new Error(provResult?.error || 'Unknown error creating tables');
    }

    return {
      success: true,
      schema: business.schema_name,
      tablesCreated: provResult.tables_created,
      modules: moduleCodes,
    };
  } catch (err) {
    logger.error({ err, businessId }, '[PROVISION] Error en provisionTenantTables');
    throw err;
  } finally {
    client.release();
  }
};