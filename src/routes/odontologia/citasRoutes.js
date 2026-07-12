// routes/odontologia/citasRoutes.js
import express from 'express';
import {
  getAll,
  getByFechaAndEspecialista,
  getByPatientId,
  getById,
  getHorariosDisponibles,
  create,
  update,
  updateStatus,
  remove,
  getStats
} from '../../controllers/odontologia/citasController.js';

const router = express.Router();

// GET /api/odontologia/citas - Listar todas
router.get('/', getAll);

// GET /api/odontologia/citas/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/citas/horarios-disponibles - Horarios disponibles
router.get('/horarios-disponibles', getHorariosDisponibles);

// GET /api/odontologia/citas/fecha-especialista - Por fecha y especialista
router.get('/fecha-especialista', getByFechaAndEspecialista);

// GET /api/odontologia/citas/patient/:patientId - Por paciente
router.get('/patient/:patientId', getByPatientId);

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