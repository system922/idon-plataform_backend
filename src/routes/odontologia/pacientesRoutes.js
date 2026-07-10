// src/routes/odontologia/pacientesRoutes.js
import express from 'express';
import { upload, multerErrorHandler } from '../../config/multer.js';
import {
  getAll,
  getById,
  search,
  getByDocument,
  create,
  update,
  remove,
  getStats,
} from '../../controllers/odontologia/pacientesController.js';

const router = express.Router();

// ============================================================
// ENDPOINTS DE PACIENTES
// ============================================================

// GET /api/odontologia/pacientes - Listar todos
router.get('/', getAll);

// GET /api/odontologia/pacientes/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/pacientes/search - Buscar (query: ?q=term)
router.get('/search', search);

// GET /api/odontologia/pacientes/document/:documentNumber - Buscar por cédula
router.get('/document/:documentNumber', getByDocument);

// GET /api/odontologia/pacientes/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/pacientes - Crear (con imagen opcional)
router.post('/', upload.single('image'), multerErrorHandler, create);

// PUT /api/odontologia/pacientes/:id - Actualizar (con imagen opcional)
router.put('/:id', upload.single('image'), multerErrorHandler, update);

// DELETE /api/odontologia/pacientes/:id - Eliminar (soft delete)
router.delete('/:id', remove);

export default router;