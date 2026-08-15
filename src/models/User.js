import { query } from '../config/database.js';

// Listar todos los usuarios de un esquema (tenant)
export async function findAllUsers(schema) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role_id, u.is_active, u.created_at,
            r.name AS role_name
     FROM "${schema}".users u
     LEFT JOIN "${schema}".roles r ON u.role_id = r.id
     WHERE u.deleted_at IS NULL
     ORDER BY u.created_at DESC`
  );
  return rows;
}

// Buscar usuario por ID en esquema
export async function findUserById(schema, id) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role_id, u.is_active, u.created_at,
            r.name AS role_name
     FROM "${schema}".users u
     LEFT JOIN "${schema}".roles r ON u.role_id = r.id
     WHERE u.id = $1 AND u.deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// Buscar usuario por email en esquema
export async function findUserByEmail(schema, email) {
  const { rows } = await query(
    `SELECT id, email, first_name, last_name, role_id, is_active
     FROM "${schema}".users
     WHERE email = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

// Buscar rol por ID en esquema
export async function findRoleById(schema, roleId) {
  const { rows } = await query(
    `SELECT id, name, code FROM "${schema}".roles WHERE id = $1`,
    [roleId]
  );
  return rows[0] || null;
}

// Crear usuario en esquema
export async function createUser(schema, { email, password_hash, first_name, last_name, role_id, is_active }) {
  const { rows } = await query(
    `INSERT INTO "${schema}".users 
      (id, email, password_hash, first_name, last_name, role_id, is_active, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, email, first_name, last_name, role_id, is_active, created_at`,
    [email, password_hash, first_name || '', last_name || '', role_id, is_active]
  );
  return rows[0];
}

// Crear relación business_users
export async function createBusinessUser({ user_id, business_id, role_id, is_active, is_owner }) {
  const { rows } = await query(
    `INSERT INTO public.business_users 
      (user_id, business_id, role_id, is_active, is_owner)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, business_id) 
     DO UPDATE SET 
       role_id = EXCLUDED.role_id,
       is_active = EXCLUDED.is_active,
       is_owner = EXCLUDED.is_owner
     RETURNING *`,
    [user_id, business_id, role_id, is_active, is_owner]
  );
  return rows[0];
}

// Actualizar usuario en esquema
export async function updateUser(schema, id, { email, password, first_name, last_name, role_id, is_active }) {
  let setParts = [];
  let params = [];
  let i = 1;

  if (email !== undefined)        { setParts.push(`email = $${i++}`); params.push(email); }
  if (first_name !== undefined)   { setParts.push(`first_name = $${i++}`); params.push(first_name); }
  if (last_name !== undefined)    { setParts.push(`last_name = $${i++}`); params.push(last_name); }
  if (role_id !== undefined)      { setParts.push(`role_id = $${i++}`); params.push(role_id); }
  if (is_active !== undefined)    { setParts.push(`is_active = $${i++}`); params.push(is_active); }
  if (password)                   { setParts.push(`password_hash = $${i++}`); params.push(password); }

  if (setParts.length === 0) return findUserById(schema, id);

  setParts.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await query(
    `UPDATE "${schema}".users
     SET ${setParts.join(', ')}
     WHERE id = $${i} AND deleted_at IS NULL
     RETURNING id, email, first_name, last_name, role_id, is_active, created_at`,
    params
  );
  return rows[0] || null;
}

// Borrado suave del usuario
export async function deleteUser(schema, id) {
  const { rows } = await query(
    `UPDATE "${schema}".users
     SET is_active = FALSE, deleted_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id]
  );
  return rows[0] || null;
}