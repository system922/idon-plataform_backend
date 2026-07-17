import * as ortodonciasService from '../../services/odontologia/ortodonciasService.js';
import * as auditLogService from '../../services/auditLogService.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

const getSchema = async (req) => await getSchemaName(req);

// ============================================================
// LISTAR TODAS LAS ORTODONCIAS
// ============================================================
export const getAll = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const data = await ortodonciasService.getAll(schema);
    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ Error en getAll ortodoncias:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER POR PACIENTE
// ============================================================
export const getByPatientId = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId } = req.params;
    if (!patientId) return res.status(400).json({ error: 'ID de paciente requerido' });

    const data = await ortodonciasService.getByPatientId(schema, patientId);
    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ Error en getByPatientId:', err);
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
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const data = await ortodonciasService.getById(schema, id);
    if (!data) return res.status(404).json({ success: false, error: 'Ortodoncia no encontrada' });

    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ Error en getById:', err);
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

    const userId = req.user?.id || req.body.user_id;
    const data = req.body;

    if (!data.paciente_id) {
      return res.status(400).json({ error: 'El paciente es obligatorio' });
    }

    const result = await ortodonciasService.create(schema, data);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'ortodoncias',
        action: 'CREATE',
        record_id: result.id,
        new_values: { paciente_id: result.paciente_id, estado: result.estado },
        description: `Ortodoncia creada para paciente ${result.paciente_id}`,
      });
    }

    res.status(201).json({
      success: true,
      data: result,
      message: 'Ortodoncia creada exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en create ortodoncia:', err);
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
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const userId = req.user?.id || req.body.user_id;
    const data = req.body;

    const oldData = await ortodonciasService.getById(schema, id);
    if (!oldData) return res.status(404).json({ success: false, error: 'Ortodoncia no encontrada' });

    const result = await ortodonciasService.update(schema, id, data);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'ortodoncias',
        action: 'UPDATE',
        record_id: id,
        old_values: { estado: oldData.estado, requiere_tratamiento: oldData.requiere_tratamiento },
        new_values: { estado: result.estado, requiere_tratamiento: result.requiere_tratamiento },
        description: `Ortodoncia actualizada para paciente ${result.paciente_id}`,
      });
    }

    res.json({
      success: true,
      data: result,
      message: 'Ortodoncia actualizada exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en update ortodoncia:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ELIMINAR (SOFT DELETE)
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const userId = req.user?.id || req.body.user_id;

    const oldData = await ortodonciasService.getById(schema, id);
    if (!oldData) return res.status(404).json({ success: false, error: 'Ortodoncia no encontrada' });

    await ortodonciasService.remove(schema, id);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'ortodoncias',
        action: 'DELETE',
        record_id: id,
        old_values: { paciente_id: oldData.paciente_id },
        description: `Ortodoncia eliminada para paciente ${oldData.paciente_id}`,
      });
    }

    res.json({
      success: true,
      message: 'Ortodoncia eliminada exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en remove ortodoncia:', err);
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

    const stats = await ortodonciasService.getStats(schema);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('❌ Error en getStats ortodoncias:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};