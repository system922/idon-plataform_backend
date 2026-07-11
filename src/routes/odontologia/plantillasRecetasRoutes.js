// routes/odontologia/plantillasRecetasRoutes.js
import express from 'express';
import {
  // Plantillas
  getAll,
  getById,
  create,
  update,
  remove,
  // Medicamentos
  getMedicamentos,
  getMedicamentoById,
  createMedicamento,
  updateMedicamento,
  removeMedicamento,
  // Tipos
  getTipos,
  getTipoById,
  createTipo,
  updateTipo,
  removeTipo,
  // Categorías
  getCategorias,
  getCategoriaById,
  createCategoria,
  updateCategoria,
  removeCategoria,
  // Tipos y Categorías juntos
  getTiposCategorias
} from '../../controllers/odontologia/plantillasRecetasController.js';

const router = express.Router();

// ============================================================
// ENDPOINTS DE PLANTILLAS DE RECETAS
// ============================================================

// GET /api/odontologia/plantillas - Listar todas
router.get('/', getAll);

// GET /api/odontologia/plantillas/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/plantillas - Crear
router.post('/', create);

// PUT /api/odontologia/plantillas/:id - Actualizar
router.put('/:id', update);

// DELETE /api/odontologia/plantillas/:id - Eliminar
router.delete('/:id', remove);

// ============================================================
// ENDPOINTS DE MEDICAMENTOS
// ============================================================

// GET /api/odontologia/plantillas/medicamentos - Listar medicamentos (con filtros)
router.get('/medicamentos', getMedicamentos);

// GET /api/odontologia/plantillas/medicamentos/:id - Obtener medicamento por ID
router.get('/medicamentos/:id', getMedicamentoById);

// POST /api/odontologia/plantillas/medicamentos - Crear medicamento
router.post('/medicamentos', createMedicamento);

// PUT /api/odontologia/plantillas/medicamentos/:id - Actualizar medicamento
router.put('/medicamentos/:id', updateMedicamento);

// DELETE /api/odontologia/plantillas/medicamentos/:id - Eliminar medicamento
router.delete('/medicamentos/:id', removeMedicamento);

// ============================================================
// ENDPOINTS DE TIPOS DE MEDICAMENTO
// ============================================================

// GET /api/odontologia/plantillas/tipos - Listar tipos
router.get('/tipos', getTipos);

// GET /api/odontologia/plantillas/tipos/:id - Obtener tipo por ID
router.get('/tipos/:id', getTipoById);

// POST /api/odontologia/plantillas/tipos - Crear tipo
router.post('/tipos', createTipo);

// PUT /api/odontologia/plantillas/tipos/:id - Actualizar tipo
router.put('/tipos/:id', updateTipo);

// DELETE /api/odontologia/plantillas/tipos/:id - Eliminar tipo
router.delete('/tipos/:id', removeTipo);

// ============================================================
// ENDPOINTS DE CATEGORÍAS DE MEDICAMENTO
// ============================================================

// GET /api/odontologia/plantillas/categorias - Listar categorías
router.get('/categorias', getCategorias);

// GET /api/odontologia/plantillas/categorias/:id - Obtener categoría por ID
router.get('/categorias/:id', getCategoriaById);

// POST /api/odontologia/plantillas/categorias - Crear categoría
router.post('/categorias', createCategoria);

// PUT /api/odontologia/plantillas/categorias/:id - Actualizar categoría
router.put('/categorias/:id', updateCategoria);

// DELETE /api/odontologia/plantillas/categorias/:id - Eliminar categoría
router.delete('/categorias/:id', removeCategoria);

// ============================================================
// ENDPOINTS COMBINADOS
// ============================================================

// GET /api/odontologia/plantillas/tipos-categorias - Obtener tipos y categorías juntos
router.get('/tipos-categorias', getTiposCategorias);

export default router;