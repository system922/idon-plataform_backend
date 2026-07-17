import express from 'express';
import { upload, multerErrorHandler } from '../../config/multer.js';
import {
  getAll,
  getByPatientId,
  getById,
  create,
  update,
  remove,
  getStats,
} from '../../controllers/odontologia/ortodonciasController.js';

const router = express.Router();

// ============================================================
// ENDPOINTS DE ORTODONCIAS
// ============================================================

// GET /api/odontologia/ortodoncias - Listar todos
router.get('/', getAll);

// GET /api/odontologia/ortodoncias/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/ortodoncias/patient/:patientId - Obtener por paciente
router.get('/patient/:patientId', getByPatientId);

// GET /api/odontologia/ortodoncias/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/ortodoncias - Crear
router.post('/', create);

// PUT /api/odontologia/ortodoncias/:id - Actualizar
router.put('/:id', update);

// DELETE /api/odontologia/ortodoncias/:id - Eliminar (soft delete)
router.delete('/:id', remove);

export default router;