// src/routes/odontologia/especialistasRoutes.js
import express from 'express';
import {
  getAll,
  getById,
  search,
  create,
  update,
  remove,
  getStats,
} from '../../controllers/odontologia/especialistasController.js';

const router = express.Router();

// GET /api/odontologia/especialistas - Listar todos
router.get('/', getAll);

// GET /api/odontologia/especialistas/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/especialistas/search - Buscar
router.get('/search', search);

// GET /api/odontologia/especialistas/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/especialistas - Crear
router.post('/', create);

// PUT /api/odontologia/especialistas/:id - Actualizar
router.put('/:id', update);

// DELETE /api/odontologia/especialistas/:id - Eliminar
router.delete('/:id', remove);

export default router;