// routes/odontologia/planPagosOrtodonciaRoutes.js
import express from 'express';
import {
  getAllByPatient,
  getAllByOrtodoncia,
  getById,
  getActiveByPatient,
  create,
  update,
  remove,
  getStats,
  registrarPago,
  generarCuotas,
} from '../../controllers/odontologia/planPagosOrtodonciaController.js';

const router = express.Router();

// ============================================================
// ENDPOINTS DE PLAN DE PAGOS DE ORTODONCIA
// ============================================================

// GET /api/odontologia/plan-pagos/patient/:patientId - Listar por paciente
router.get('/patient/:patientId', getAllByPatient);

// GET /api/odontologia/plan-pagos/ortodoncia/:ortodonciaId - Listar por ortodoncia
router.get('/ortodoncia/:ortodonciaId', getAllByOrtodoncia);

// GET /api/odontologia/plan-pagos/active/:patientId - Obtener plan activo por paciente
router.get('/active/:patientId', getActiveByPatient);

// GET /api/odontologia/plan-pagos/:id - Obtener por ID
router.get('/:id', getById);

// GET /api/odontologia/plan-pagos/:id/stats - Estadísticas del plan
router.get('/:id/stats', getStats);

// POST /api/odontologia/plan-pagos - Crear plan con cuotas
router.post('/', create);

// POST /api/odontologia/plan-pagos/:id/pagar - Registrar pago de cuota
router.post('/:id/pagar', registrarPago);

// POST /api/odontologia/plan-pagos/:id/generar-cuotas - Regenerar cuotas
router.post('/:id/generar-cuotas', generarCuotas);

// PUT /api/odontologia/plan-pagos/:id - Actualizar plan
router.put('/:id', update);

// DELETE /api/odontologia/plan-pagos/:id - Eliminar plan
router.delete('/:id', remove);

export default router;