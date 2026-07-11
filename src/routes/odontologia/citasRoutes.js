// src/routes/odontologia/citasRoutes.js
import express from 'express';
import {
  getAll,
  getById,
  create,
  update,
  remove,
  getStats,
  getByDate,
  updateStatus,
} from '../../controllers/odontologia/citasController.js';

const router = express.Router();

// GET /api/odontologia/citas - Listar todos (con filtros)
router.get('/', getAll);

// GET /api/odontologia/citas/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/citas/date/:date - Obtener por fecha
router.get('/date/:date', getByDate);

// GET /api/odontologia/citas/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/citas - Crear
router.post('/', create);

// PUT /api/odontologia/citas/:id - Actualizar
router.put('/:id', update);

// PATCH /api/odontologia/citas/:id/status - Actualizar estado
router.patch('/:id/status', updateStatus);

// DELETE /api/odontologia/citas/:id - Eliminar
router.delete('/:id', remove);

export default router;