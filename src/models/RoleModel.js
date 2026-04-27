import { query } from '../config/database.js';

const SELECT = `SELECT id, name, description, permissions, created_at FROM`;
const parsePerms = p  => typeof p === 'string' ? JSON.parse(p) : (p ?? []);
const withPerms  = row => ({ ...row, permissions: parsePerms(row.permissions) });

export const findAll = async (schema) => {
  const { rows } = await query(`${SELECT} "${schema}".roles ORDER BY id ASC`);
  return rows.map(withPerms);
};

export const findById = async (schema, id) => {
  const { rows } = await query(
    `${SELECT} "${schema}".roles WHERE id = $1 LIMIT 1`, [id]
  );
  return rows[0] ? withPerms(rows[0]) : null;
};

export const insert = async (schema, { name, description, permissions }) => {
  const { rows } = await query(
    `INSERT INTO "${schema}".roles (name, description, permissions)
     VALUES ($1, $2, $3)
     RETURNING id, name, description, permissions, created_at`,
    [name, description, JSON.stringify(permissions)]
  );
  return rows[0];
};

export const updateById = async (schema, id, { name, description, permissions }) => {
  const { rows } = await query(
    `UPDATE "${schema}".roles
     SET name=$1, description=$2, permissions=$3
     WHERE id=$4
     RETURNING id, name, description, permissions, created_at`,
    [name, description, JSON.stringify(permissions), id]
  );
  if (!rows.length) throw new Error('Rol no encontrado');
  return rows[0];
};

export const deleteById = async (schema, id) => {
  const { rows } = await query(
    `DELETE FROM "${schema}".roles WHERE id = $1 RETURNING id`, [id]
  );
  if (!rows.length) throw new Error('Rol no encontrado');
};