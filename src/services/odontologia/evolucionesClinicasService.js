// services/odontologia/evolucionesClinicasService.js
import * as evolucionesModel from '../../models/odontologia/evolucionesClinicasModel.js';
import * as planesModel from '../../models/odontologia/planesTratamientoModel.js';
import * as odontogramasModel from '../../models/odontologia/odontogramasModel.js';

export const getAllByPatient = async (schema, patientId) => {
  try {
    if (!patientId) throw new Error('El ID del paciente es obligatorio');
    return await evolucionesModel.findByPatientId(schema, patientId);
  } catch (error) {
    throw new Error(`Error al obtener evoluciones: ${error.message}`);
  }
};

export const getByPlan = async (schema, planId) => {
  try {
    if (!planId) throw new Error('El ID del plan es obligatorio');
    return await evolucionesModel.findByPlanId(schema, planId);
  } catch (error) {
    throw new Error(`Error al obtener evoluciones del plan: ${error.message}`);
  }
};

export const getById = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const evolucion = await evolucionesModel.findById(schema, id);
    if (!evolucion) throw new Error('Evolución no encontrada');
    return evolucion;
  } catch (error) {
    throw new Error(`Error al obtener evolución: ${error.message}`);
  }
};

export const create = async (schema, data) => {
  try {
    if (!data.patient_id) throw new Error('El paciente es obligatorio');
    if (!data.tooth_number) throw new Error('El número de diente es obligatorio');
    
    // Buscar resultado automático si existe
    if (data.diagnostico_inicial && data.tratamiento_nombre) {
      const resultado = await evolucionesModel.findResultadoByDiagnosticoTratamiento(
        schema,
        data.diagnostico_inicial,
        data.tratamiento_nombre
      );
      if (resultado) {
        data.resultado_final = resultado;
      }
    }
    
    return await evolucionesModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear evolución: ${error.message}`);
  }
};

export const update = async (schema, id, data) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await evolucionesModel.findById(schema, id);
    if (!existing) throw new Error('Evolución no encontrada');
    
    // Si se actualiza el estado a 'completado' y no hay resultado, buscar automático
    if (data.estado === 'completado' && !data.resultado_final) {
      const resultado = await evolucionesModel.findResultadoByDiagnosticoTratamiento(
        schema,
        existing.diagnostico_inicial,
        data.tratamiento_nombre || existing.tratamiento_nombre
      );
      if (resultado) {
        data.resultado_final = resultado;
      }
    }
    
    // Si el tratamiento se completó, actualizar el plan
    if (data.estado === 'completado' && existing.plan_id) {
      // Verificar si todos los tratamientos del plan están completados
      const evolucionesPlan = await evolucionesModel.findByPlanId(schema, existing.plan_id);
      const allCompleted = evolucionesPlan.every(e => e.estado === 'completado' || e.id === id);
      
      if (allCompleted) {
        await planesModel.updateById(schema, existing.plan_id, { status: 'completed' });
      }
    }
    
    return await evolucionesModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar evolución: ${error.message}`);
  }
};

export const remove = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await evolucionesModel.findById(schema, id);
    if (!existing) throw new Error('Evolución no encontrada');
    return await evolucionesModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar evolución: ${error.message}`);
  }
};

export const getEstadoDiente = async (schema, patientId, toothNumber) => {
  try {
    return await evolucionesModel.getEstadoDiente(schema, patientId, toothNumber);
  } catch (error) {
    throw new Error(`Error al obtener estado del diente: ${error.message}`);
  }
};

export const getAllDientesEvolucion = async (schema, patientId) => {
  try {
    return await evolucionesModel.getAllDientesEvolucion(schema, patientId);
  } catch (error) {
    throw new Error(`Error al obtener dientes en evolución: ${error.message}`);
  }
};

export const getEvolucionCompleta = async (schema, patientId) => {
  try {
    // Obtener odontograma inicial
    const odontogramaInicial = await odontogramasModel.findByPatientAndFase(schema, patientId, 'inicial');
    const teethInicial = odontogramaInicial?.teeth || {};
    
    // Obtener evoluciones clínicas
    const evoluciones = await evolucionesModel.findByPatientId(schema, patientId);
    
    // Mapear estado actual por diente
    const estadoActual = {};
    evoluciones.forEach(e => {
      estadoActual[e.tooth_number] = {
        diagnostico_inicial: e.diagnostico_inicial,
        tratamiento: e.tratamiento_nombre,
        estado: e.estado,
        resultado_final: e.resultado_final,
        fecha_ejecucion: e.fecha_ejecucion
      };
    });
    
    // Construir resultado
    const resultado = {
      inicial: {},
      evolucion: {},
      resumen: []
    };
    
    Object.keys(teethInicial).forEach(key => {
      const toothNum = parseInt(key);
      const hallazgo = teethInicial[key]?.condition || teethInicial[key]?.hallazgo || '';
      
      resultado.inicial[toothNum] = hallazgo;
      
      if (estadoActual[toothNum]) {
        resultado.evolucion[toothNum] = estadoActual[toothNum];
        resultado.resumen.push({
          tooth: toothNum,
          diagnostico_inicial: hallazgo,
          tratamiento: estadoActual[toothNum].tratamiento,
          estado: estadoActual[toothNum].estado,
          resultado: estadoActual[toothNum].resultado_final || hallazgo,
          fecha: estadoActual[toothNum].fecha_ejecucion
        });
      } else {
        resultado.resumen.push({
          tooth: toothNum,
          diagnostico_inicial: hallazgo,
          tratamiento: null,
          estado: 'pendiente',
          resultado: hallazgo,
          fecha: null
        });
      }
    });
    
    return resultado;
  } catch (error) {
    throw new Error(`Error al obtener evolución completa: ${error.message}`);
  }
};