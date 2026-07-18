// controllers/odontologia/ortodonciasController.js
import { getSchemaName } from '../../utils/tenantHelper.js';
import * as ortodonciasService from '../../services/odontologia/ortodonciasService.js';
import * as auditLogService from '../../services/auditLogService.js';

// ============================================================
// FUNCIÓN AUXILIAR PARA OBTENER SCHEMA
// ============================================================
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

    const registros = await ortodonciasService.getAll(schema);
    res.json({
      success: true,
      data: registros,
    });
  } catch (err) {
    console.error('❌ Error en getAll ortodoncias:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// OBTENER POR ID DE PACIENTE
// ============================================================
export const getByPatientId = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId } = req.params;
    if (!patientId) return res.status(400).json({ error: 'ID de paciente requerido' });

    const registro = await ortodonciasService.getByPatientId(schema, patientId);
    res.json({
      success: true,
      data: registro || null,
    });
  } catch (err) {
    console.error('❌ Error en getByPatientId:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
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

    const registro = await ortodonciasService.getById(schema, id);
    if (!registro) {
      return res.status(404).json({
        success: false,
        error: 'Registro de ortodoncia no encontrado'
      });
    }

    res.json({
      success: true,
      data: registro,
    });
  } catch (err) {
    console.error('❌ Error en getById ortodoncias:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
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

    // Parsear datos
    let data = req.body;
    if (req.body.data) {
      try {
        data = JSON.parse(req.body.data);
      } catch (e) {
        data = req.body;
      }
    }

    // Validaciones
    if (!data.paciente_id) {
      return res.status(400).json({ error: 'El paciente_id es obligatorio' });
    }

    const registro = await ortodonciasService.create(schema, data);

    // --- Registrar auditoría ---
    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'ortodoncias',
        action: 'CREATE',
        record_id: registro.id,
        new_values: {
          paciente_id: registro.paciente_id,
          requiere_tratamiento: registro.requiere_tratamiento,
          estado: registro.estado,
          doctor: registro.doctor,
        },
        description: `Registro de ortodoncia creado para paciente ID: ${registro.paciente_id}`
      });
    }

    res.status(201).json({
      success: true,
      data: registro,
      message: 'Registro de ortodoncia creado exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en create ortodoncias:', err);
    if (err.message.includes('ya existe')) {
      return res.status(409).json({
        success: false,
        error: err.message,
      });
    }
    res.status(500).json({
      success: false,
      error: err.message
    });
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

    // Obtener registro actual (para auditoría)
    const registroActual = await ortodonciasService.getById(schema, id);
    if (!registroActual) {
      return res.status(404).json({ error: 'Registro de ortodoncia no encontrado' });
    }

    // Parsear datos
    let data = req.body;
    if (req.body.data) {
      try {
        data = JSON.parse(req.body.data);
      } catch (e) {
        data = req.body;
      }
    }

    const registro = await ortodonciasService.update(schema, id, data);

    // --- Registrar auditoría ---
    if (userId) {
      const oldValues = {};
      const newValues = {};
      const camposCambiados = [];

      ['requiere_tratamiento', 'estado', 'doctor', 'fecha_inicio', 'fecha_fin'].forEach(campo => {
        if (data[campo] !== undefined && data[campo] !== registroActual[campo]) {
          oldValues[campo] = registroActual[campo];
          newValues[campo] = data[campo];
          camposCambiados.push(campo);
        }
      });

      if (Object.keys(newValues).length > 0) {
        await auditLogService.createAuditLog(schema, {
          user_id: userId,
          table_name: 'ortodoncias',
          action: 'UPDATE',
          record_id: registro.id,
          old_values: oldValues,
          new_values: newValues,
          description: `Ortodoncia actualizada - Campos: ${camposCambiados.join(', ')}`
        });
      }
    }

    res.json({
      success: true,
      data: registro,
      message: 'Registro de ortodoncia actualizado exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en update ortodoncias:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
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

    // Obtener registro actual (para auditoría)
    const registro = await ortodonciasService.getById(schema, id);
    if (!registro) {
      return res.status(404).json({ error: 'Registro de ortodoncia no encontrado' });
    }

    await ortodonciasService.remove(schema, id);

    // --- Registrar auditoría ---
    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'ortodoncias',
        action: 'DELETE',
        record_id: id,
        old_values: {
          paciente_id: registro.paciente_id,
          requiere_tratamiento: registro.requiere_tratamiento,
          estado: registro.estado,
          doctor: registro.doctor,
        },
        description: `Registro de ortodoncia eliminado para paciente ID: ${registro.paciente_id}`
      });
    }

    res.json({
      success: true,
      message: 'Registro de ortodoncia eliminado exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en remove ortodoncias:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
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
    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    console.error('❌ Error en getStats ortodoncias:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// CREAR O ACTUALIZAR (UPSERT)
// ============================================================
export const upsert = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const userId = req.user?.id || req.body.user_id;
    const { paciente_id } = req.params;
    const data = req.body;

    if (!paciente_id) {
      return res.status(400).json({ error: 'El paciente_id es obligatorio' });
    }

    const registro = await ortodonciasService.upsert(schema, paciente_id, data);

    res.json({
      success: true,
      data: registro,
      message: `Registro ${registro._wasCreated ? 'creado' : 'actualizado'} exitosamente`,
    });
  } catch (err) {
    console.error('❌ Error en upsert ortodoncias:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};