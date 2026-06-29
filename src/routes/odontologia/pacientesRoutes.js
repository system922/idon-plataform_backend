// src/routes/odontologia/pacientesRoutes.js
import express from 'express';
import {
  getAll,
  getById,
  search,
  create,
  update,
  remove,
  getStats,
} from '../../controllers/odontologia/pacientesController.js';
import { authMiddleware, businessContextMiddleware } from '../../middleware/auth.js';

const router = express.Router();

// Todas las rutas requieren autenticación y contexto de negocio
router.use(authMiddleware, businessContextMiddleware);

// GET /api/odontologia/pacientes - Listar todos los pacientes
router.get('/', getAll);

// GET /api/odontologia/pacientes/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/pacientes/search - Buscar pacientes
router.get('/search', search);

// GET /api/odontologia/pacientes/:id - Obtener un paciente
router.get('/:id', getById);

// POST /api/odontologia/pacientes - Crear paciente
router.post('/', create);

// PUT /api/odontologia/pacientes/:id - Actualizar paciente
router.put('/:id', update);

// DELETE /api/odontologia/pacientes/:id - Eliminar paciente
router.delete('/:id', remove);

export default router;