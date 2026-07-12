// services/odontologia/plantillasRecetasService.js
import * as plantillasModel from '../../models/odontologia/plantillasRecetasModel.js';
import * as medicamentosModel from '../../models/odontologia/medicamentosModel.js';
import * as tiposCategoriasModel from '../../models/odontologia/tiposCategoriasModel.js';

// ============================================================
// PLANTILLAS (CRUD completo)
// ============================================================

export const getAll = async (schema) => {
  try {
    return await plantillasModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar plantillas: ${error.message}`);
  }
};

export const getById = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const plantilla = await plantillasModel.findById(schema, id);
    if (!plantilla) throw new Error('Plantilla no encontrada');
    return plantilla;
  } catch (error) {
    throw new Error(`Error al obtener plantilla: ${error.message}`);
  }
};

export const create = async (schema, data) => {
  try {
    if (!data.nombre) throw new Error('El nombre es obligatorio');
    if (!data.medicamentos || data.medicamentos.length === 0) {
      throw new Error('La plantilla debe tener al menos un medicamento');
    }
    return await plantillasModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear plantilla: ${error.message}`);
  }
};

export const update = async (schema, id, data) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await plantillasModel.findById(schema, id);
    if (!existing) throw new Error('Plantilla no encontrada');
    return await plantillasModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar plantilla: ${error.message}`);
  }
};

export const remove = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await plantillasModel.findById(schema, id);
    if (!existing) throw new Error('Plantilla no encontrada');
    return await plantillasModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar plantilla: ${error.message}`);
  }
};

// ============================================================
// MEDICAMENTOS
// ============================================================

export const getMedicamentos = async (schema, tipoId = null, categoriaId = null) => {
  try {
    return await medicamentosModel.findByTipoCategoria(schema, tipoId, categoriaId);
  } catch (error) {
    throw new Error(`Error al listar medicamentos: ${error.message}`);
  }
};

export const getMedicamentoById = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    return await medicamentosModel.findById(schema, id);
  } catch (error) {
    throw new Error(`Error al obtener medicamento: ${error.message}`);
  }
};

export const createMedicamento = async (schema, data) => {
  try {
    if (!data.nombre) throw new Error('El nombre es obligatorio');
    if (!data.tipo_id) throw new Error('El tipo es obligatorio');
    if (!data.categoria_id) throw new Error('La categoría es obligatoria');
    return await medicamentosModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear medicamento: ${error.message}`);
  }
};

export const updateMedicamento = async (schema, id, data) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await medicamentosModel.findById(schema, id);
    if (!existing) throw new Error('Medicamento no encontrado');
    return await medicamentosModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar medicamento: ${error.message}`);
  }
};

export const removeMedicamento = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await medicamentosModel.findById(schema, id);
    if (!existing) throw new Error('Medicamento no encontrado');
    return await medicamentosModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar medicamento: ${error.message}`);
  }
};

// ============================================================
// TIPOS Y CATEGORÍAS (CRUD completo)
// ============================================================

export const getTipos = async (schema) => {
  try {
    return await tiposCategoriasModel.findAllTipos(schema);
  } catch (error) {
    throw new Error(`Error al listar tipos: ${error.message}`);
  }
};

export const getTipoById = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const tipo = await tiposCategoriasModel.findTipoById(schema, id);
    if (!tipo) throw new Error('Tipo no encontrado');
    return tipo;
  } catch (error) {
    throw new Error(`Error al obtener tipo: ${error.message}`);
  }
};

export const createTipo = async (schema, data) => {
  try {
    if (!data.nombre) throw new Error('El nombre del tipo es obligatorio');
    return await tiposCategoriasModel.insertTipo(schema, data);
  } catch (error) {
    throw new Error(`Error al crear tipo: ${error.message}`);
  }
};

export const updateTipo = async (schema, id, data) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await tiposCategoriasModel.findTipoById(schema, id);
    if (!existing) throw new Error('Tipo no encontrado');
    return await tiposCategoriasModel.updateTipoById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar tipo: ${error.message}`);
  }
};

export const removeTipo = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await tiposCategoriasModel.findTipoById(schema, id);
    if (!existing) throw new Error('Tipo no encontrado');
    return await tiposCategoriasModel.softDeleteTipo(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar tipo: ${error.message}`);
  }
};

export const getCategorias = async (schema) => {
  try {
    return await tiposCategoriasModel.findAllCategorias(schema);
  } catch (error) {
    throw new Error(`Error al listar categorías: ${error.message}`);
  }
};

export const getCategoriaById = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const categoria = await tiposCategoriasModel.findCategoriaById(schema, id);
    if (!categoria) throw new Error('Categoría no encontrada');
    return categoria;
  } catch (error) {
    throw new Error(`Error al obtener categoría: ${error.message}`);
  }
};

export const createCategoria = async (schema, data) => {
  try {
    if (!data.nombre) throw new Error('El nombre de la categoría es obligatorio');
    return await tiposCategoriasModel.insertCategoria(schema, data);
  } catch (error) {
    throw new Error(`Error al crear categoría: ${error.message}`);
  }
};

export const updateCategoria = async (schema, id, data) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await tiposCategoriasModel.findCategoriaById(schema, id);
    if (!existing) throw new Error('Categoría no encontrada');
    return await tiposCategoriasModel.updateCategoriaById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar categoría: ${error.message}`);
  }
};

export const removeCategoria = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await tiposCategoriasModel.findCategoriaById(schema, id);
    if (!existing) throw new Error('Categoría no encontrada');
    return await tiposCategoriasModel.softDeleteCategoria(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar categoría: ${error.message}`);
  }
};

export const getTiposCategorias = async (schema) => {
  try {
    const tipos = await tiposCategoriasModel.findAllTipos(schema);
    const categorias = await tiposCategoriasModel.findAllCategorias(schema);
    return { tipos, categorias };
  } catch (error) {
    throw new Error(`Error al obtener tipos y categorías: ${error.message}`);
  }
};