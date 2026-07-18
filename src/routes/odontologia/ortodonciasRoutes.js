// routes/odontologia/ortodonciasRoutes.js
import express from 'express';
import {
  getAll,
  getById,
  getByPatientId,
  create,
  update,
  remove,
  getStats,
  upsert,
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

// PUT /api/odontologia/ortodoncias/patient/:paciente_id - Crear o actualizar (upsert)
router.put('/patient/:paciente_id', upsert);

// DELETE /api/odontologia/ortodoncias/:id - Eliminar (soft delete)
router.delete('/:id', remove);

export default router;