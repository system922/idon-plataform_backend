// services/odontologia/ortodonciasService.js
import { query } from '../../config/database.js';
import * as ortodonciasModel from '../../models/odontologia/ortodonciasModel.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await ortodonciasModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar ortodoncias: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR ID DE PACIENTE
// ============================================================
export const getByPatientId = async (schema, patientId) => {
  try {
    if (!patientId) {
      throw new Error('El ID del paciente es obligatorio');
    }
    return await ortodonciasModel.findByPatientId(schema, patientId);
  } catch (error) {
    throw new Error(`Error al obtener ortodoncia por paciente: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const getById = async (schema, id) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }
    const registro = await ortodonciasModel.findById(schema, id);
    if (!registro) {
      throw new Error('Registro de ortodoncia no encontrado');
    }
    return registro;
  } catch (error) {
    throw new Error(`Error al obtener ortodoncia: ${error.message}`);
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data) => {
  try {
    // Validaciones
    if (!data.paciente_id) {
      throw new Error('El paciente_id es obligatorio');
    }

    // Verificar que el paciente existe
    const pacienteCheck = await query(
      `SELECT id FROM "${schema}".pacientes WHERE id = $1 AND deleted_at IS NULL`,
      [data.paciente_id]
    );
    
    if (pacienteCheck.rows.length === 0) {
      throw new Error('Paciente no encontrado');
    }

    // Verificar si ya existe un registro para este paciente
    const existing = await ortodonciasModel.findByPatientId(schema, data.paciente_id);
    if (existing) {
      throw new Error('Ya existe un registro de ortodoncia para este paciente');
    }

    return await ortodonciasModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear ortodoncia: ${error.message}`);
  }
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const update = async (schema, id, data) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }

    // Verificar que existe
    const existing = await ortodonciasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Registro de ortodoncia no encontrado');
    }

    return await ortodonciasModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar ortodoncia: ${error.message}`);
  }
};

// ============================================================
// ELIMINAR (SOFT DELETE)
// ============================================================
export const remove = async (schema, id) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }

    const existing = await ortodonciasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Registro de ortodoncia no encontrado');
    }

    return await ortodonciasModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar ortodoncia: ${error.message}`);
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (schema) => {
  try {
    return await ortodonciasModel.getStats(schema);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};

// ============================================================
// CREAR O ACTUALIZAR (UPSERT)
// ============================================================
export const upsert = async (schema, pacienteId, data) => {
  try {
    // Verificar si ya existe
    const existing = await ortodonciasModel.findByPatientId(schema, pacienteId);
    
    if (existing) {
      // Actualizar
      const updated = await ortodonciasModel.updateById(schema, existing.id, data);
      return { ...updated, _wasCreated: false };
    } else {
      // Crear nuevo
      const created = await ortodonciasModel.insert(schema, {
        ...data,
        paciente_id: pacienteId,
      });
      return { ...created, _wasCreated: true };
    }
  } catch (error) {
    throw new Error(`Error al guardar ortodoncia: ${error.message}`);
  }
};