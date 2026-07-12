// src/routes/odontologia/odontogramasRoutes.js
import express from 'express';
import {
  getAll,
  getByPatientId,
  getByPatientAndFase,
  getByPlanId,
  saveOdontograma,
  updateOdontograma,
  remove,
  getStats,
  syncFromInicial,
  syncFromEvolucion
} from '../../controllers/odontologia/odontogramasController.js';

const router = express.Router();

// ============================================================
// RUTAS ESPECÍFICAS (sin :id) - VAN PRIMERO
// ============================================================

// GET /api/odontologia/odontogramas/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/odontogramas/patient/:patientId - Por paciente
router.get('/patient/:patientId', getByPatientId);

// GET /api/odontologia/odontogramas/patient/:patientId/fase/:fase - Por paciente y fase
router.get('/patient/:patientId/fase/:fase', getByPatientAndFase);

// GET /api/odontologia/odontogramas/plan/:planId - Por plan de tratamiento
router.get('/plan/:planId', getByPlanId);

// POST /api/odontologia/odontogramas/sync/inicial - Sincronizar desde Inicial
router.post('/sync/inicial', syncFromInicial);

// POST /api/odontologia/odontogramas/sync/evolucion - Sincronizar desde Evolución
router.post('/sync/evolucion', syncFromEvolucion);

// ============================================================
// RUTAS CON :id - VAN DESPUÉS
// ============================================================

// GET /api/odontologia/odontogramas - Listar todos
router.get('/', getAll);

// POST /api/odontologia/odontogramas - Guardar
router.post('/', saveOdontograma);

// PUT /api/odontologia/odontogramas/:id - Actualizar
router.put('/:id', updateOdontograma);

// DELETE /api/odontologia/odontogramas/:id - Eliminar
router.delete('/:id', remove);

export default router;