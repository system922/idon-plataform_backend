import db from '../../config/database.js';
import * as pacienteService from '../../services/odontologia/pacientesService.js';
import * as auditLogService from '../../services/auditLogService.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

// ============================================================
// FUNCIÓN AUXILIAR PARA OBTENER SCHEMA
// ============================================================
const getSchema = async (req) => {
  return await getSchemaName(req);
};

// ============================================================
// LISTAR TODOS LOS PACIENTES
// ============================================================
export const getAll = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const pacientes = await pacienteService.getAll(schema);
    res.json({
      success: true,
      data: pacientes,
    });
  } catch (err) {
    console.error('❌ Error en getAll pacientes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// OBTENER PACIENTE POR ID
// ============================================================
export const getById = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const paciente = await pacienteService.getById(schema, id);
    if (!paciente) {
      return res.status(404).json({
        success: false,
        error: 'Paciente no encontrado'
      });
    }

    res.json({
      success: true,
      data: paciente,
    });
  } catch (err) {
    console.error('❌ Error en getById pacientes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// BUSCAR PACIENTES
// ============================================================
export const search = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'La búsqueda debe tener al menos 2 caracteres'
      });
    }

    const pacientes = await pacienteService.search(schema, q.trim());
    res.json({
      success: true,
      data: pacientes,
    });
  } catch (err) {
    console.error('❌ Error en search pacientes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// OBTENER PACIENTE POR CÉDULA
// ============================================================
export const getByDocument = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { documentNumber } = req.params;
    if (!documentNumber) return res.status(400).json({ error: 'Cédula requerida' });

    const paciente = await pacienteService.getByDocument(schema, documentNumber);
    res.json({
      success: true,
      data: paciente || null,
    });
  } catch (err) {
    console.error('❌ Error en getByDocument:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// CREAR PACIENTE
// ============================================================
export const create = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    // Obtener usuario autenticado
    const userId = req.user?.id || req.body.user_id;

    // Parsear los datos del formulario
    let data = {};
    if (req.body.data) {
      try {
        data = JSON.parse(req.body.data);
      } catch (e) {
        data = req.body;
      }
    } else {
      data = req.body;
    }

    const fileBuffer = req.file?.buffer;

    // Validaciones
    if (!data.document_number) {
      return res.status(400).json({ error: 'La cédula es obligatoria' });
    }
    if (data.document_number.length !== 10) {
      return res.status(400).json({ error: 'La cédula debe tener 10 dígitos' });
    }
    if (!data.first_name) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    if (!data.last_name) {
      return res.status(400).json({ error: 'El apellido es obligatorio' });
    }

    // Verificar que la cédula no esté duplicada
    const existing = await pacienteService.getByDocument(schema, data.document_number);
    if (existing) {
      return res.status(409).json({ error: 'Ya existe un paciente con esta cédula' });
    }

    const paciente = await pacienteService.create(schema, data, fileBuffer);

    // --- Registrar auditoría ---
    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'pacientes',
        action: 'CREATE',
        record_id: paciente.id,
        new_values: {
          document_number: paciente.document_number,
          first_name: paciente.first_name,
          last_name: paciente.last_name,
          email: paciente.email,
          phone: paciente.phone,
          hc_number: paciente.hc_number,
        },
        description: `Paciente creado: ${paciente.first_name} ${paciente.last_name} (${paciente.document_number})`
      });
    }

    res.status(201).json({
      success: true,
      data: paciente,
      message: 'Paciente creado exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en create pacientes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// ACTUALIZAR PACIENTE
// ============================================================
export const update = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    // Obtener usuario autenticado
    const userId = req.user?.id || req.body.user_id;

    // Obtener paciente actual (para auditoría)
    const pacienteActual = await pacienteService.getById(schema, id);
    if (!pacienteActual) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    // Parsear los datos del formulario
    let data = {};
    if (req.body.data) {
      try {
        data = JSON.parse(req.body.data);
      } catch (e) {
        data = req.body;
      }
    } else {
      data = req.body;
    }

    const fileBuffer = req.file?.buffer;

    // Si se envía cédula, verificar que no esté duplicada
    if (data.document_number && data.document_number !== pacienteActual.document_number) {
      const duplicated = await pacienteService.getByDocument(schema, data.document_number);
      if (duplicated) {
        return res.status(409).json({ error: 'Ya existe un paciente con esta cédula' });
      }
    }

    const paciente = await pacienteService.update(schema, id, data, fileBuffer);

    // --- Registrar auditoría ---
    if (userId) {
      // Preparar valores antiguos y nuevos para auditoría
      const oldValues = {};
      const newValues = {};
      const camposCambiados = [];

      ['document_number', 'first_name', 'last_name', 'email', 'phone', 'address', 
     'blood_type', 'allergies', 'medical_history', 'is_active'].forEach(campo => {
        if (data[campo] !== undefined && data[campo] !== pacienteActual[campo]) {
          oldValues[campo] = pacienteActual[campo];
          newValues[campo] = data[campo];
          camposCambiados.push(campo);
        }
      });

      if (Object.keys(newValues).length > 0) {
        await auditLogService.createAuditLog(schema, {
          user_id: userId,
          table_name: 'pacientes',
          action: 'UPDATE',
          record_id: paciente.id,
          old_values: oldValues,
          new_values: newValues,
          description: `Paciente actualizado: ${paciente.first_name} ${paciente.last_name} - Campos: ${camposCambiados.join(', ')}`
        });
      }
    }

    res.json({
      success: true,
      data: paciente,
      message: 'Paciente actualizado exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en update pacientes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// ELIMINAR PACIENTE (SOFT DELETE)
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    // Obtener usuario autenticado
    const userId = req.user?.id || req.body.user_id;

    // Obtener paciente actual (para auditoría)
    const paciente = await pacienteService.getById(schema, id);
    if (!paciente) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }

    await pacienteService.remove(schema, id);

    // --- Registrar auditoría ---
    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'pacientes',
        action: 'DELETE',
        record_id: id,
        old_values: {
          document_number: paciente.document_number,
          first_name: paciente.first_name,
          last_name: paciente.last_name,
          email: paciente.email,
          phone: paciente.phone,
          hc_number: paciente.hc_number,
        },
        description: `Paciente eliminado: ${paciente.first_name} ${paciente.last_name} (${paciente.document_number})`
      });
    }

    res.json({
      success: true,
      message: 'Paciente eliminado exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en remove pacientes:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({
        success: false,
        error: err.message,
      });
    }
    if (err.message.includes('tiene citas asociadas')) {
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
// ESTADÍSTICAS DE PACIENTES
// ============================================================
export const getStats = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const stats = await pacienteService.getStats(schema);
    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    console.error('❌ Error en getStats pacientes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};