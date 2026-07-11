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
// 🔴 IMPORTANTE: Las rutas específicas DEBEN ir ANTES de las rutas con parámetros (:id)
// ============================================================

// ============================================================
// ENDPOINTS DE TIPOS DE MEDICAMENTO (rutas específicas)
// ============================================================
router.get('/tipos-categorias', getTiposCategorias);  // Combinado
router.get('/tipos', getTipos);                      // Listar tipos
router.get('/tipos/:id', getTipoById);               // Obtener tipo por ID
router.post('/tipos', createTipo);
router.put('/tipos/:id', updateTipo);
router.delete('/tipos/:id', removeTipo);

// ============================================================
// ENDPOINTS DE CATEGORÍAS DE MEDICAMENTO (rutas específicas)
// ============================================================
router.get('/categorias', getCategorias);            // Listar categorías
router.get('/categorias/:id', getCategoriaById);     // Obtener categoría por ID
router.post('/categorias', createCategoria);
router.put('/categorias/:id', updateCategoria);
router.delete('/categorias/:id', removeCategoria);

// ============================================================
// ENDPOINTS DE MEDICAMENTOS (rutas específicas)
// ============================================================
router.get('/medicamentos', getMedicamentos);        // Listar medicamentos
router.get('/medicamentos/:id', getMedicamentoById); // Obtener medicamento por ID
router.post('/medicamentos', createMedicamento);
router.put('/medicamentos/:id', updateMedicamento);
router.delete('/medicamentos/:id', removeMedicamento);

// ============================================================
// ENDPOINTS DE PLANTILLAS (rutas con parámetro :id - VAN AL FINAL)
// ============================================================
router.get('/', getAll);           // Listar todas
router.get('/:id', getById);       // Obtener por ID - DEBE IR DESPUÉS DE LAS RUTAS ESPECÍFICAS
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;