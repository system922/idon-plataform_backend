import * as roleService from '../services/roleService.js';

const getSchema = (req, res) => {
  if (!req.schema) { res.status(400).json({ error: 'Business context required' }); return null; }
  return req.schema;
};

export const getAll = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    res.json({ roles: await roleService.getAll(schema) });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const getById = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    const role = await roleService.getById(schema, req.params.id);
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });
    res.json({ role });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const create = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    const { name, description, permissions } = req.body;
    if (!name || !permissions) return res.status(400).json({ error: 'Nombre y permisos requeridos' });
    res.status(201).json({ role: await roleService.create(schema, { name, description, permissions }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const update = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    const { name, description, permissions } = req.body;
    if (!name || !permissions) return res.status(400).json({ error: 'Nombre y permisos requeridos' });
    res.json({ role: await roleService.update(schema, req.params.id, { name, description, permissions }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const remove = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    await roleService.remove(schema, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};