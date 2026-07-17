// src/services/odontologia/odontogramasService.js
import * as odontogramasModel from '../../models/odontologia/odontogramasModel.js';

// ============================================================
// CONDICIONES FAVORABLES Y NO FAVORABLES
// ============================================================
const CONDICIONES_FAVORABLES = [
  'diente_sano',
  'resina_adaptada',
  'amalgama_adaptada',
  'sellante_bueno',
  'corona_buena',
  'provisional',
  'endodoncia_buena',
  'perno_bueno',
  'implante_bueno',
  'ponico'
];

const HALLAZGOS_GLOBALES = [
  'extraccion_indicada',
  'endodoncia_mala',
  'perno_malo',
  'implante_malo',
  'diente_ausente',
  'otro'
];

const esCondicionNoFavorable = (condition) => {
  return !CONDICIONES_FAVORABLES.includes(condition) && condition && condition !== '';
};

const esHallazgoGlobal = (condition) => {
  return HALLAZGOS_GLOBALES.includes(condition);
};

// ✅ Función para obtener hallazgos NO favorables de un diente
const obtenerHallazgosNoFavorablesDelDiente = (tooth, toothNumber) => {
  const resultados = [];
  const caras = tooth?.caras || {};
  const condition = tooth?.condition || '';

  // 1. Hallazgos por superficie (caries, resina_desadaptada, etc.)
  Object.entries(caras).forEach(([surface, cond]) => {
    if (esCondicionNoFavorable(cond) && !esHallazgoGlobal(cond)) {
      resultados.push({
        tooth: toothNumber,
        surface,
        condition: cond,
        surfaces: [surface],
        tipo: 'superficial'
      });
    }
  });

  // 2. Hallazgos globales (endodoncia_mala, perno_malo, etc.)
  if (esCondicionNoFavorable(condition) && esHallazgoGlobal(condition)) {
    resultados.push({
      tooth: toothNumber,
      surface: 'global',
      condition: condition,
      surfaces: ['global'],
      tipo: 'global'
    });
  }

  return resultados;
};

// ✅ Función para construir el plan_tratamiento automáticamente
const construirPlanTratamiento = (teeth) => {
  const plan = [];
  
  Object.keys(teeth || {}).forEach((key) => {
    const toothNumber = parseInt(key);
    const tooth = teeth[key];
    const hallazgos = obtenerHallazgosNoFavorablesDelDiente(tooth, toothNumber);
    
    hallazgos.forEach(hallazgo => {
      // Solo agregar si no existe ya un tratamiento para este hallazgo
      const existe = plan.some(p => 
        p.tooth === hallazgo.tooth && 
        p.condition === hallazgo.condition &&
        p.surfaces?.join(',') === hallazgo.surfaces?.join(',')
      );
      
      if (!existe) {
        plan.push({
          id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          tooth: hallazgo.tooth,
          hallazgo: hallazgo.condition,
          surfaces: hallazgo.surfaces,
          tipo: hallazgo.tipo,
          servicio_id: null,
          servicio: '',
          price: 0,
          estado: 'pendiente',
          observaciones: ''
        });
      }
    });
  });
  
  return plan;
};

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await odontogramasModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar odontogramas: ${error.message}`);
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
    const odontograma = await odontogramasModel.findById(schema, id);
    if (!odontograma) {
      throw new Error('Odontograma no encontrado');
    }
    return odontograma;
  } catch (error) {
    throw new Error(`Error al obtener odontograma: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR PACIENTE
// ============================================================
export const getByPatientId = async (schema, patientId) => {
  try {
    if (!patientId) {
      throw new Error('El ID del paciente es obligatorio');
    }
    return await odontogramasModel.findByPatientId(schema, patientId);
  } catch (error) {
    throw new Error(`Error al obtener odontogramas del paciente: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR PACIENTE Y FASE (MODIFICADO)
// ============================================================
export const getByPatientAndFase = async (schema, patientId, fase) => {
  try {
    if (!patientId) {
      throw new Error('El ID del paciente es obligatorio');
    }
    if (!fase) {
      throw new Error('La fase es obligatoria');
    }

    const odontograma = await odontogramasModel.findByPatientAndFase(schema, patientId, fase);
    
    // Si no existe, devolver estructura vacía con plan_tratamiento construido
    if (!odontograma) {
      return {
        id: null,
        patient_id: patientId,
        fase: fase,
        teeth: {},
        plan_tratamiento: [],
        notas: '',
        plan_id: null,
        last_saved_at: null
      };
    }
    
    // ✅ Asegurar que plan_tratamiento sea un array
    if (odontograma.plan_tratamiento && !Array.isArray(odontograma.plan_tratamiento)) {
      odontograma.plan_tratamiento = [];
    }
    
    // ✅ Si es Inicial y no tiene plan_tratamiento o está vacío, construirlo
    if (fase === 'inicial' && (!odontograma.plan_tratamiento || odontograma.plan_tratamiento.length === 0)) {
      odontograma.plan_tratamiento = construirPlanTratamiento(odontograma.teeth);
    }
    
    return odontograma;
  } catch (error) {
    throw new Error(`Error al obtener odontograma por paciente y fase: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR PLAN DE TRATAMIENTO
// ============================================================
export const getByPlanId = async (schema, planId) => {
  try {
    if (!planId) {
      throw new Error('El ID del plan es obligatorio');
    }
    return await odontogramasModel.findByPlanId(schema, planId);
  } catch (error) {
    throw new Error(`Error al obtener odontograma por plan: ${error.message}`);
  }
};

// ============================================================
// GUARDAR ODONTOGRAMA (MODIFICADO)
// ============================================================
export const save = async (schema, data) => {
  try {
    const { patient_id, fase, teeth, plan_tratamiento, notas, plan_id } = data;

    if (!patient_id) {
      throw new Error('El ID del paciente es obligatorio');
    }
    if (!fase) {
      throw new Error('La fase es obligatoria');
    }

    const fasesValidas = ['inicial', 'evolucion', 'alta'];
    if (!fasesValidas.includes(fase)) {
      throw new Error('Fase inválida. Debe ser: inicial, evolucion o alta');
    }

    // Verificar si ya existe
    const existing = await odontogramasModel.findByPatientAndFase(schema, patient_id, fase);

    let finalTeeth = teeth || {};
    // If we have existing teeth and didn't provide new teeth data, keep existing
    if (existing && (!teeth || Object.keys(teeth).length === 0)) {
      finalTeeth = existing.teeth;
    }

    // ✅ Si es Inicial y no hay plan_tratamiento, construirlo automáticamente
    let finalPlanTratamiento = plan_tratamiento || [];
    if (fase === 'inicial' && (!finalPlanTratamiento || finalPlanTratamiento.length === 0)) {
      finalPlanTratamiento = construirPlanTratamiento(finalTeeth);
    }

    if (existing) {
      // ✅ Actualizar existente (asegurar que plan_tratamiento sea array)
      const updateData = {
        teeth: finalTeeth,
        plan_tratamiento: Array.isArray(finalPlanTratamiento) ? finalPlanTratamiento : [],
        notas: notas !== undefined ? notas : existing.notas,
        plan_id: plan_id !== undefined ? plan_id : existing.plan_id,
        last_saved_at: new Date().toISOString()
      };
      
      return await odontogramasModel.updateById(schema, existing.id, updateData);
    } else {
      // ✅ Crear nuevo (asegurar que plan_tratamiento sea array)
      const insertData = {
        patient_id,
        fase,
        teeth: finalTeeth,
        plan_tratamiento: Array.isArray(finalPlanTratamiento) ? finalPlanTratamiento : [],
        notas: notas || '',
        plan_id: plan_id || null
      };
      
      return await odontogramasModel.insert(schema, insertData);
    }
  } catch (error) {
    throw new Error(`Error al guardar odontograma: ${error.message}`);
  }
};

// ============================================================
// ACTUALIZAR ODONTOGRAMA
// ============================================================
export const update = async (schema, id, data) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }

    const existing = await odontogramasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Odontograma no encontrado');
    }

    // ✅ Asegurar que plan_tratamiento sea array
    if (data.plan_tratamiento !== undefined) {
      data.plan_tratamiento = Array.isArray(data.plan_tratamiento) ? data.plan_tratamiento : [];
    }

    return await odontogramasModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar odontograma: ${error.message}`);
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

    const existing = await odontogramasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Odontograma no encontrado');
    }

    return await odontogramasModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar odontograma: ${error.message}`);
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (schema) => {
  try {
    return await odontogramasModel.getStats(schema);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};

// ============================================================
// SINCRONIZAR DESDE INICIAL A EVOLUCION
// ============================================================
export const syncFromInicial = async (schema, patientId) => {
  try {
    // Obtener odontograma inicial
    const inicial = await odontogramasModel.findByPatientAndFase(schema, patientId, 'inicial');
    
    if (!inicial) {
      throw new Error('No existe odontograma inicial para sincronizar');
    }

    // Obtener o crear evolucion
    let evolucion = await odontogramasModel.findByPatientAndFase(schema, patientId, 'evolucion');
    
    // Sincronizar dientes (mantener plan de tratamiento existente)
    const evolucionTeeth = { ...inicial.teeth };
    
    if (evolucion) {
      // Actualizar evolucion
      return await odontogramasModel.updateById(schema, evolucion.id, {
        teeth: evolucionTeeth,
        last_saved_at: new Date().toISOString()
      });
    } else {
      // Crear evolucion
      return await odontogramasModel.insert(schema, {
        patient_id: patientId,
        fase: 'evolucion',
        teeth: evolucionTeeth,
        plan_tratamiento: [],
        notas: 'Sincronizado desde Inicial'
      });
    }
  } catch (error) {
    throw new Error(`Error al sincronizar desde Inicial: ${error.message}`);
  }
};

// ============================================================
// SINCRONIZAR DESDE EVOLUCION A ALTA
// ============================================================
export const syncFromEvolucion = async (schema, patientId) => {
  try {
    // Obtener odontograma evolucion
    const evolucion = await odontogramasModel.findByPatientAndFase(schema, patientId, 'evolucion');
    
    if (!evolucion) {
      throw new Error('No existe odontograma de evolución para sincronizar');
    }

    // Filtrar solo condiciones favorables
    const altaTeeth = {};
    Object.keys(evolucion.teeth || {}).forEach((key) => {
      const tooth = evolucion.teeth[key];
      const condition = tooth.condition || '';
      if (CONDICIONES_FAVORABLES.includes(condition)) {
        altaTeeth[key] = { ...tooth };
      }
    });

    // Obtener o crear alta
    let alta = await odontogramasModel.findByPatientAndFase(schema, patientId, 'alta');
    
    if (alta) {
      // Actualizar alta
      return await odontogramasModel.updateById(schema, alta.id, {
        teeth: altaTeeth,
        plan_tratamiento: [],
        last_saved_at: new Date().toISOString()
      });
    } else {
      // Crear alta
      return await odontogramasModel.insert(schema, {
        patient_id: patientId,
        fase: 'alta',
        teeth: altaTeeth,
        plan_tratamiento: [],
        notas: 'Sincronizado desde Evolución'
      });
    }
  } catch (error) {
    throw new Error(`Error al sincronizar desde Evolución: ${error.message}`);
  }
};