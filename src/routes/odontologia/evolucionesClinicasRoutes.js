// routes/odontologia/evolucionesClinicasRoutes.js
import express from 'express';
import {
  getByPatientId,
  getByPlanId,
  getEvolucionCompleta,
  getEstadoDiente,
  create,
  update,
  remove
} from '../../controllers/odontologia/evolucionesClinicasController.js';

const router = express.Router();

// GET /api/odontologia/evoluciones/patient/:patientId - Todas las evoluciones del paciente
router.get('/patient/:patientId', getByPatientId);

// GET /api/odontologia/evoluciones/patient/:patientId/completa - Evolución completa (Inicial + Evoluciones)
router.get('/patient/:patientId/completa', getEvolucionCompleta);

// GET /api/odontologia/evoluciones/patient/:patientId/tooth/:toothNumber - Estado de un diente
router.get('/patient/:patientId/tooth/:toothNumber', getEstadoDiente);

// GET /api/odontologia/evoluciones/plan/:planId - Evoluciones por plan
router.get('/plan/:planId', getByPlanId);

// POST /api/odontologia/evoluciones - Crear
router.post('/', create);

// PUT /api/odontologia/evoluciones/:id - Actualizar
router.put('/:id', update);

// DELETE /api/odontologia/evoluciones/:id - Eliminar
router.delete('/:id', remove);

export default router;