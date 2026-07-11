// src/routes/odontologia/tratamientosRoutes.js
import express from 'express';
import {
  getAll,
  getById,
  search,
  create,
  update,
  remove,
  getStats,
} from '../../controllers/odontologia/tratamientosController.js';

const router = express.Router();

// GET /api/odontologia/tratamientos - Listar todos
router.get('/', getAll);

// GET /api/odontologia/tratamientos/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/tratamientos/search - Buscar (query: ?q=term)
router.get('/search', search);

// GET /api/odontologia/tratamientos/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/tratamientos - Crear
router.post('/', create);

// PUT /api/odontologia/tratamientos/:id - Actualizar
router.put('/:id', update);

// DELETE /api/odontologia/tratamientos/:id - Eliminar
router.delete('/:id', remove);

export default router;