import { query } from '../config/database.js';

// Listar todos los usuarios de un esquema (tenant)
export async function findAllUsers(schema) {
  const { rows } = await query(
    `SELECT id, email, first_name, last_name, role_id, is_active, created_at
     FROM "${schema}".users
     ORDER BY created_at DESC`
  );
  return rows;
}

// Buscar usuario por ID en esquema
export async function findUserById(schema, id) {
  const { rows } = await query(
    `SELECT id, email, first_name, last_name, role_id, is_active, created_at
     FROM "${schema}".users
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// Crear usuario en esquema
export async function createUser(schema, { email, password_hash, first_name, last_name, role_id, is_active }) {
  const { rows } = await query(
    `INSERT INTO "${schema}".users 
      (email, password_hash, first_name, last_name, role_id, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, email, first_name, last_name, role_id, is_active, created_at`,
    [email, password_hash, first_name || '', last_name || '', role_id, is_active]
  );
  return rows[0];
}

// Actualizar usuario en esquema
export async function updateUser(schema, id, { email, password, first_name, last_name, role_id, is_active }) {
  // El update puede ser parcial, arma tus SET dinámicamente si quieres
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

  params.push(id);

  const { rows } = await query(
    `UPDATE "${schema}".users
     SET ${setParts.join(', ')}
     WHERE id = $${i}
     RETURNING id, email, first_name, last_name, role_id, is_active, created_at`,
    params
  );
  return rows[0] || null;
}

// Borrado suave del usuario (por ejemplo, desactivar)
export async function deleteUser(schema, id) {
  // Podrías hacer borrado real o solo is_active = false
  const { rows } = await query(
    `UPDATE "${schema}".users
     SET is_active = FALSE
     WHERE id = $1
     RETURNING id`,
    [id]
  );
  return rows[0] || null;
}