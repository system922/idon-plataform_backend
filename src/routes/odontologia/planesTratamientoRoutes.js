// routes/odontologia/planesTratamientoRoutes.js
import express from 'express';
import {
  getAll,
  getByPatientId,
  getById,
  create,
  update,
  remove,
  getStats
} from '../../controllers/odontologia/planesTratamientoController.js';

const router = express.Router();

// GET /api/odontologia/planes-tratamiento - Listar todos
router.get('/', getAll);

// GET /api/odontologia/planes-tratamiento/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/planes-tratamiento/patient/:patientId - Listar por paciente
router.get('/patient/:patientId', getByPatientId);

// GET /api/odontologia/planes-tratamiento/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/planes-tratamiento - Crear
router.post('/', create);

// PUT /api/odontologia/planes-tratamiento/:id - Actualizar
router.put('/:id', update);

// DELETE /api/odontologia/planes-tratamiento/:id - Eliminar
router.delete('/:id', remove);

export default router;