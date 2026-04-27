import bcrypt from 'bcrypt';
import * as userModel from '../models/user.js';
import { getSchemaName } from '../utils/tenantHelper.js';

// LISTAR USUARIOS
export async function getUsers(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const users = await userModel.findAllUsers(schema);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// UNO
export async function getUser(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id } = req.params;
    const user = await userModel.findUserById(schema, id);
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// CREAR
export async function createUser(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { email, password, first_name, last_name, role_id, is_active } = req.body;
    if (!email || !password || !role_id)
      return res.status(400).json({ error: 'Email, contraseña y rol son requeridos' });

    const password_hash = await bcrypt.hash(password, 12);

    const user = await userModel.createUser(schema, {
      email,
      password_hash,
      first_name: first_name || '',
      last_name: last_name || '',
      role_id,
      is_active: typeof is_active === 'boolean' ? is_active : true
    });
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'El correo ya existe' });
    res.status(500).json({ error: err.message });
  }
}

// ACTUALIZAR
export async function updateUser(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id } = req.params;
    const { first_name, last_name, password, role_id, is_active, email } = req.body;
    let password_hash;
    if (password) password_hash = await bcrypt.hash(password, 12);

    const user = await userModel.updateUser(
      schema,
      id,
      {
        first_name,
        last_name,
        email,
        role_id,
        is_active,
        password: password_hash
      }
    );
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ELIMINAR (borrado suave)
export async function deleteUser(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id } = req.params;
    const result = await userModel.deleteUser(schema, id);
    if (!result) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}