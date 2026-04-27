import { query } from '../config/database.js';

/**
 * Resolves the tenant schema name from the request.
 * Priority: X-DB-Name header → X-Business-ID header → JWT businessId
 */
export async function getSchemaName(req) {
  const fromHeader = req.headers['x-db-name'] || req.headers['x-schema-name'];
  if (fromHeader) return fromHeader;

  const businessId = req.headers['x-business-id'] || req.user?.businessId;
  if (businessId) {
    const { rows } = await query(
      'SELECT schema_name FROM public.businesses WHERE id = $1',
      [businessId]
    );
    if (rows[0]?.schema_name) return rows[0].schema_name;
  }

  return null;
}
