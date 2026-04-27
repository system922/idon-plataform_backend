import { query } from '../config/database.js';

export const createAuditLog = async (
  schema,
  { user_id, table_name, action, record_id = null, old_values = null, new_values = null, description = '' }
) => {
  const { rows } = await query(
    `INSERT INTO "${schema}".audit_logs
      (user_id, table_name, action, record_id, old_values, new_values, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [user_id, table_name, action, record_id, old_values, new_values, description]
  );
  return rows[0];
};

export async function listAuditLogsWithUser(schema, { limit = 100, table_name, action, user_id }) {
  const where = [];
  const params = [];
  let idx = 1;

  if (table_name)   { where.push(`table_name = $${idx++}`); params.push(table_name); }
  if (action)       { where.push(`action = $${idx++}`);     params.push(action); }
  if (user_id)      { where.push(`user_id = $${idx++}`);    params.push(user_id); }

  const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  // 1. Obtén los logs de audit_logs
  const { rows: logs } = await query(
    `SELECT * FROM "${schema}".audit_logs ${whereStr} ORDER BY created_at DESC LIMIT $${idx}`,
    params
  );
  if (!logs.length) return [];

  // 2. Busca los usuarios únicos
  const userIds = Array.from(new Set(logs.map(l => l.user_id).filter(Boolean)));

  // 3. Busca en public.users
  let globalUsers = [];
  if (userIds.length) {
    const res = await query(
      `SELECT id, COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), email) AS display_name 
         FROM public.users WHERE id = ANY($1)`,
      [userIds]
    );
    globalUsers = res.rows;
  }

  // 4. Busca en schema.users (solo los que faltan)
  const foundGlobal = new Set(globalUsers.map(u => u.id));
  const missing = userIds.filter(id => !foundGlobal.has(id));
  let schemaUsers = [];
  if (missing.length > 0) {
    const res = await query(
      `SELECT id, COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), email) AS display_name 
         FROM "${schema}".users WHERE id = ANY($1)`,
      [missing]
    );
    schemaUsers = res.rows;
  }

  // 5. Diccionario de usuarios
  const userDict = {};
  for (const row of [...globalUsers, ...schemaUsers]) {
    if (!(row.id in userDict)) userDict[row.id] = row.display_name;
  }

  // 6. Devuelve logs con display_name
  return logs.map(log => ({
    ...log,
    user_display_name: userDict[log.user_id] || log.user_id || '',
  }));
}