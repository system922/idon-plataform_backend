// routes/odontologia/citasRoutes.js
import express from 'express';
import {
  getAll,
  getByFechaAndEspecialista,
  getByPatientId,
  getById,
  getHorariosDisponibles,
  getEspecialistasDisponibles,
  create,
  update,
  updateStatus,
  remove,
  getStats
} from '../../controllers/odontologia/citasController.js';

const router = express.Router();

// ============================================================
// RUTAS ESPECÍFICAS (sin :id) - VAN PRIMERO
// ============================================================

// GET /api/odontologia/citas/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/citas/horarios-disponibles - Horarios disponibles
router.get('/horarios-disponibles', getHorariosDisponibles);

// GET /api/odontologia/citas/especialistas-disponibles - Especialistas disponibles
router.get('/especialistas-disponibles', getEspecialistasDisponibles);

// GET /api/odontologia/citas/fecha-especialista - Por fecha y especialista
router.get('/fecha-especialista', getByFechaAndEspecialista);

// GET /api/odontologia/citas/patient/:patientId - Por paciente (tiene :id pero es específico)
router.get('/patient/:patientId', getByPatientId);

// ============================================================
// RUTAS CON :id - VAN DESPUÉS
// ============================================================

// GET /api/odontologia/citas - Listar todas
router.get('/', getAll);

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