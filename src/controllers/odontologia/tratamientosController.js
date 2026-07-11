// src/controllers/odontologia/tratamientosController.js
import * as tratamientosService from '../../services/odontologia/tratamientosService.js';
import * as auditLogService from '../../services/auditLogService.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

const getSchema = async (req) => {
  return await getSchemaName(req);
};

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const tratamientos = await tratamientosService.getAll(schema);
    res.json({ success: true, data: tratamientos });
  } catch (err) {
    console.error('❌ Error en getAll tratamientos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const getById = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const tratamiento = await tratamientosService.getById(schema, id);
    res.json({ success: true, data: tratamiento });
  } catch (err) {
    console.error('❌ Error en getById tratamientos:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// BUSCAR
// ============================================================
export const search = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'La búsqueda debe tener al menos 2 caracteres' });
    }

    const tratamientos = await tratamientosService.search(schema, q.trim());
    res.json({ success: true, data: tratamientos });
  } catch (err) {
    console.error('❌ Error en search tratamientos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const userId = req.user?.id || req.body.created_by;
    const tratamiento = await tratamientosService.create(schema, req.body);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'tratamientos',
        action: 'CREATE',
        record_id: tratamiento.id,
        new_values: {
          name: tratamiento.name,
          duration_minutes: tratamiento.duration_minutes,
          price: tratamiento.price,
        },
        description: `Tratamiento creado: ${tratamiento.name}`
      });
    }

    res.status(201).json({
      success: true,
      data: tratamiento,
      message: 'Tratamiento creado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en create tratamientos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const update = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const userId = req.user?.id || req.body.created_by;

    const tratamiento = await tratamientosService.update(schema, id, req.body);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'tratamientos',
        action: 'UPDATE',
        record_id: tratamiento.id,
        new_values: req.body,
        description: `Tratamiento actualizado: ${tratamiento.name}`
      });
    }

    res.json({
      success: true,
      data: tratamiento,
      message: 'Tratamiento actualizado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en update tratamientos:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ELIMINAR
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const userId = req.user?.id;

    const tratamiento = await tratamientosService.getById(schema, id);
    await tratamientosService.remove(schema, id);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'tratamientos',
        action: 'DELETE',
        record_id: id,
        old_values: {
          name: tratamiento.name,
        },
        description: `Tratamiento eliminado: ${tratamiento.name}`
      });
    }

    res.json({
      success: true,
      message: 'Tratamiento eliminado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en remove tratamientos:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('tiene citas asociadas')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const stats = await tratamientosService.getStats(schema);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('❌ Error en getStats tratamientos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};