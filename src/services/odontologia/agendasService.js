// src/services/odontologia/agendasService.js
import * as agendasModel from '../../models/odontologia/agendasModel.js';
import * as especialistasModel from '../../models/odontologia/especialistasModel.js';
import * as gruposModel from '../../models/odontologia/gruposAgendasModel.js';

const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await agendasModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar agendas: ${error.message}`);
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
    return await agendasModel.findById(schema, id);
  } catch (error) {
    throw new Error(`Error al obtener agenda: ${error.message}`);
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data) => {
  try {
    // Validaciones básicas
    if (!data.nombre) {
      throw new Error('El nombre es obligatorio');
    }
    if (data.nombre.length < 3) {
      throw new Error('El nombre debe tener al menos 3 caracteres');
    }
    if (!data.especialista_id) {
      throw new Error('El especialista es obligatorio');
    }

    // Verificar que el especialista exista
    const especialista = await especialistasModel.findById(schema, data.especialista_id);
    if (!especialista) {
      throw new Error('El especialista no existe');
    }
    if (!especialista.is_active) {
      throw new Error('El especialista está inactivo');
    }

    // Verificar que el grupo exista (si se envía)
    if (data.grupo_id) {
      const grupo = await gruposModel.findById(schema, data.grupo_id);
      if (!grupo) {
        throw new Error('El grupo no existe');
      }
    }

    // Validar días
    if (data.dias && data.dias.length > 0) {
      const diasSet = new Set();
      for (const dia of data.dias) {
        if (!DIAS_VALIDOS.includes(dia.dia)) {
          throw new Error(`Día inválido: ${dia.dia}. Debe ser uno de: ${DIAS_VALIDOS.join(', ')}`);
        }
        if (diasSet.has(dia.dia)) {
          throw new Error(`Día duplicado: ${dia.dia}`);
        }
        diasSet.add(dia.dia);
        
        // Validar horarios
        if (dia.activo !== false) {
          if (!dia.inicio || !dia.fin) {
            throw new Error(`El día ${dia.dia} debe tener hora de inicio y fin`);
          }
          if (dia.inicio >= dia.fin) {
            throw new Error(`En ${dia.dia}, la hora de inicio debe ser menor que la hora de fin`);
          }
        }
      }
    }

    // Validar días libres
    if (data.dias_libres && data.dias_libres.length > 0) {
      const fechasSet = new Set();
      for (const dl of data.dias_libres) {
        if (!dl.fecha) {
          throw new Error('La fecha del día libre es obligatoria');
        }
        if (!dl.motivo) {
          throw new Error('El motivo del día libre es obligatorio');
        }
        if (fechasSet.has(dl.fecha)) {
          throw new Error(`Fecha duplicada: ${dl.fecha}`);
        }
        fechasSet.add(dl.fecha);
      }
    }

    return await agendasModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear agenda: ${error.message}`);
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
    const existing = await agendasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Agenda no encontrada');
    }

    // Validar nombre
    if (data.nombre && data.nombre.length < 3) {
      throw new Error('El nombre debe tener al menos 3 caracteres');
    }

    // Verificar que el especialista exista (si se envía)
    if (data.especialista_id) {
      const especialista = await especialistasModel.findById(schema, data.especialista_id);
      if (!especialista) {
        throw new Error('El especialista no existe');
      }
      if (!especialista.is_active) {
        throw new Error('El especialista está inactivo');
      }
    }

    // Verificar que el grupo exista (si se envía)
    if (data.grupo_id) {
      const grupo = await gruposModel.findById(schema, data.grupo_id);
      if (!grupo) {
        throw new Error('El grupo no existe');
      }
    }

    // Validar días
    if (data.dias && data.dias.length > 0) {
      const diasSet = new Set();
      for (const dia of data.dias) {
        if (!DIAS_VALIDOS.includes(dia.dia)) {
          throw new Error(`Día inválido: ${dia.dia}. Debe ser uno de: ${DIAS_VALIDOS.join(', ')}`);
        }
        if (diasSet.has(dia.dia)) {
          throw new Error(`Día duplicado: ${dia.dia}`);
        }
        diasSet.add(dia.dia);
        
        // Validar horarios
        if (dia.activo !== false) {
          if (!dia.inicio || !dia.fin) {
            throw new Error(`El día ${dia.dia} debe tener hora de inicio y fin`);
          }
          if (dia.inicio >= dia.fin) {
            throw new Error(`En ${dia.dia}, la hora de inicio debe ser menor que la hora de fin`);
          }
        }
      }
    }

    // Validar días libres
    if (data.dias_libres && data.dias_libres.length > 0) {
      const fechasSet = new Set();
      for (const dl of data.dias_libres) {
        if (!dl.fecha) {
          throw new Error('La fecha del día libre es obligatoria');
        }
        if (!dl.motivo) {
          throw new Error('El motivo del día libre es obligatorio');
        }
        if (fechasSet.has(dl.fecha)) {
          throw new Error(`Fecha duplicada: ${dl.fecha}`);
        }
        fechasSet.add(dl.fecha);
      }
    }

    return await agendasModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar agenda: ${error.message}`);
  }
};

// ============================================================
// ELIMINAR
// ============================================================
export const remove = async (schema, id) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }

    const existing = await agendasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Agenda no encontrada');
    }

    return await agendasModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar agenda: ${error.message}`);
  }
};

// ============================================================
// AGREGAR DÍA LIBRE
// ============================================================
export const addDiaLibre = async (schema, agendaId, data) => {
  try {
    if (!agendaId) {
      throw new Error('El ID de la agenda es obligatorio');
    }

    // Verificar que la agenda existe
    const agenda = await agendasModel.findById(schema, agendaId);
    if (!agenda) {
      throw new Error('Agenda no encontrada');
    }

    if (!data.fecha) {
      throw new Error('La fecha es obligatoria');
    }
    if (!data.motivo) {
      throw new Error('El motivo es obligatorio');
    }
    if (data.motivo.length < 3) {
      throw new Error('El motivo debe tener al menos 3 caracteres');
    }

    // Verificar que la fecha no sea en el pasado
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fecha = new Date(data.fecha);
    if (fecha < today) {
      throw new Error('No se pueden agregar días libres en el pasado');
    }

    return await agendasModel.addDiaLibre(schema, agendaId, data);
  } catch (error) {
    throw new Error(`Error al agregar día libre: ${error.message}`);
  }
};

// ============================================================
// ELIMINAR DÍA LIBRE
// ============================================================
export const removeDiaLibre = async (schema, agendaId, diaLibreId) => {
  try {
    if (!agendaId) {
      throw new Error('El ID de la agenda es obligatorio');
    }
    if (!diaLibreId) {
      throw new Error('El ID del día libre es obligatorio');
    }

    // Verificar que la agenda existe
    const agenda = await agendasModel.findById(schema, agendaId);
    if (!agenda) {
      throw new Error('Agenda no encontrada');
    }

    return await agendasModel.removeDiaLibre(schema, agendaId, diaLibreId);
  } catch (error) {
    throw new Error(`Error al eliminar día libre: ${error.message}`);
  }
};

// ============================================================
// OBTENER DÍAS LIBRES
// ============================================================
export const getDiasLibres = async (schema, agendaId) => {
  try {
    if (!agendaId) {
      throw new Error('El ID de la agenda es obligatorio');
    }

    // Verificar que la agenda existe
    const agenda = await agendasModel.findById(schema, agendaId);
    if (!agenda) {
      throw new Error('Agenda no encontrada');
    }

    return await agendasModel.getDiasLibres(schema, agendaId);
  } catch (error) {
    throw new Error(`Error al obtener días libres: ${error.message}`);
  }
};

// ============================================================
// OBTENER AGENDA POR ESPECIALISTA
// ============================================================
export const getByEspecialista = async (schema, especialistaId) => {
  try {
    if (!especialistaId) {
      throw new Error('El ID del especialista es obligatorio');
    }

    // Verificar que el especialista existe
    const especialista = await especialistasModel.findById(schema, especialistaId);
    if (!especialista) {
      throw new Error('Especialista no encontrado');
    }

    const agendas = await agendasModel.findAll(schema);
    return agendas.filter(a => a.especialista_id === especialistaId);
  } catch (error) {
    throw new Error(`Error al obtener agenda por especialista: ${error.message}`);
  }
};

// ============================================================
// OBTENER AGENDA POR GRUPO
// ============================================================
export const getByGrupo = async (schema, grupoId) => {
  try {
    if (!grupoId) {
      throw new Error('El ID del grupo es obligatorio');
    }

    const grupo = await gruposModel.findById(schema, grupoId);
    if (!grupo) {
      throw new Error('Grupo no encontrado');
    }

    const agendas = await agendasModel.findAll(schema);
    return agendas.filter(a => a.grupo_id === grupoId);
  } catch (error) {
    throw new Error(`Error al obtener agenda por grupo: ${error.message}`);
  }
};