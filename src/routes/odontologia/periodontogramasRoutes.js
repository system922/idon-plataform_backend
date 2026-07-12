// src/routes/odontologia/periodontogramasRoutes.js
import express from 'express';
import {
  getAll,
  getByPatientId,
  getByPatientIdAndFase,
  savePeriodontograma,
  updatePeriodontograma,
  remove,
  getStats
} from '../../controllers/odontologia/periodontogramasController.js';

const router = express.Router();

// ============================================================
// RUTAS ESPECÍFICAS (sin :id) - VAN PRIMERO
// ============================================================

// GET /api/odontologia/periodontogramas/stats - Estadísticas
router.get('/stats', getStats);

// GET /api/odontologia/periodontogramas/patient/:patientId - Por paciente
router.get('/patient/:patientId', getByPatientId);

// GET /api/odontologia/periodontogramas/patient/:patientId/fase/:fase - Por paciente y fase (inicial/seguimiento)
router.get('/patient/:patientId/fase/:fase', getByPatientIdAndFase);

// ============================================================
// RUTAS CON :id - VAN DESPUÉS
// ============================================================

// GET /api/odontologia/periodontogramas - Listar todos
router.get('/', getAll);

// POST /api/odontologia/periodontogramas - Guardar
router.post('/', savePeriodontograma);

// PUT /api/odontologia/periodontogramas/:id - Actualizar
router.put('/:id', updatePeriodontograma);

// DELETE /api/odontologia/periodontogramas/:id - Eliminar
router.delete('/:id', remove);

export default router;