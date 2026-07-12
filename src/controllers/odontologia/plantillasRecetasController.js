// controllers/odontologia/plantillasRecetasController.js
import * as plantillasService from '../../services/odontologia/plantillasRecetasService.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

const getSchema = async (req) => {
  return await getSchemaName(req);
};

// ============================================================
// PLANTILLAS
// ============================================================

export const getAll = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const plantillas = await plantillasService.getAll(schema);
    
    // Asegurar que siempre devuelva un array
    res.json({ 
      success: true, 
      data: Array.isArray(plantillas) ? plantillas : [] 
    });
  } catch (err) {
    console.error('❌ Error en getAll plantillas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getById = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const plantilla = await plantillasService.getById(schema, id);
    res.json({ success: true, data: plantilla });
  } catch (err) {
    console.error('❌ Error en getById plantilla:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

export const create = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const data = req.body;
    const plantilla = await plantillasService.create(schema, data);
    res.status(201).json({
      success: true,
      data: plantilla,
      message: 'Plantilla creada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en create plantilla:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const update = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const data = req.body;
    const plantilla = await plantillasService.update(schema, id, data);
    res.json({
      success: true,
      data: plantilla,
      message: 'Plantilla actualizada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en update plantilla:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

export const remove = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    await plantillasService.remove(schema, id);
    res.json({
      success: true,
      message: 'Plantilla eliminada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en remove plantilla:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// MEDICAMENTOS
// ============================================================

export const getMedicamentos = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { tipoId, categoriaId } = req.query;
    const medicamentos = await plantillasService.getMedicamentos(schema, tipoId, categoriaId);
    res.json({ success: true, data: Array.isArray(medicamentos) ? medicamentos : [] });
  } catch (err) {
    console.error('❌ Error en getMedicamentos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getMedicamentoById = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const medicamento = await plantillasService.getMedicamentoById(schema, id);
    if (!medicamento) {
      return res.status(404).json({ success: false, error: 'Medicamento no encontrado' });
    }
    res.json({ success: true, data: medicamento });
  } catch (err) {
    console.error('❌ Error en getMedicamentoById:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createMedicamento = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const data = req.body;
    const medicamento = await plantillasService.createMedicamento(schema, data);
    res.status(201).json({
      success: true,
      data: medicamento,
      message: 'Medicamento creado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en createMedicamento:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateMedicamento = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const data = req.body;
    const medicamento = await plantillasService.updateMedicamento(schema, id, data);
    res.json({
      success: true,
      data: medicamento,
      message: 'Medicamento actualizado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en updateMedicamento:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

export const removeMedicamento = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    await plantillasService.removeMedicamento(schema, id);
    res.json({
      success: true,
      message: 'Medicamento eliminado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en removeMedicamento:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('siendo usado en plantillas')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// TIPOS DE MEDICAMENTO (CRUD completo)
// ============================================================

export const getTipos = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const tipos = await plantillasService.getTipos(schema);
    res.json({ success: true, data: Array.isArray(tipos) ? tipos : [] });
  } catch (err) {
    console.error('❌ Error en getTipos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getTipoById = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const tipo = await plantillasService.getTipoById(schema, id);
    res.json({ success: true, data: tipo });
  } catch (err) {
    console.error('❌ Error en getTipoById:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createTipo = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const data = req.body;
    const tipo = await plantillasService.createTipo(schema, data);
    res.status(201).json({
      success: true,
      data: tipo,
      message: 'Tipo creado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en createTipo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateTipo = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const data = req.body;
    const tipo = await plantillasService.updateTipo(schema, id, data);
    res.json({
      success: true,
      data: tipo,
      message: 'Tipo actualizado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en updateTipo:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

export const removeTipo = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    await plantillasService.removeTipo(schema, id);
    res.json({
      success: true,
      message: 'Tipo eliminado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en removeTipo:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('tiene medicamentos asociados')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// CATEGORÍAS DE MEDICAMENTO (CRUD completo)
// ============================================================

export const getCategorias = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const categorias = await plantillasService.getCategorias(schema);
    res.json({ success: true, data: Array.isArray(categorias) ? categorias : [] });
  } catch (err) {
    console.error('❌ Error en getCategorias:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getCategoriaById = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const categoria = await plantillasService.getCategoriaById(schema, id);
    res.json({ success: true, data: categoria });
  } catch (err) {
    console.error('❌ Error en getCategoriaById:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createCategoria = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const data = req.body;
    const categoria = await plantillasService.createCategoria(schema, data);
    res.status(201).json({
      success: true,
      data: categoria,
      message: 'Categoría creada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en createCategoria:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateCategoria = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const data = req.body;
    const categoria = await plantillasService.updateCategoria(schema, id, data);
    res.json({
      success: true,
      data: categoria,
      message: 'Categoría actualizada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en updateCategoria:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

export const removeCategoria = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    await plantillasService.removeCategoria(schema, id);
    res.json({
      success: true,
      message: 'Categoría eliminada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en removeCategoria:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('tiene medicamentos asociados')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER TIPOS Y CATEGORÍAS JUNTOS
// ============================================================
export const getTiposCategorias = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const data = await plantillasService.getTiposCategorias(schema);
    res.json({ success: true, data: data || { tipos: [], categorias: [] } });
  } catch (err) {
    console.error('❌ Error en getTiposCategorias:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};