// routes/odontologia/cuotasOrtodonciaRoutes.js
import express from 'express';
import {
  getAllByPlan,
  getById,
  updateEstado,
  remove,
} from '../../controllers/odontologia/cuotasOrtodonciaController.js';

const router = express.Router();

// ============================================================
// ENDPOINTS DE CUOTAS DE ORTODONCIA
// ============================================================

// GET /api/odontologia/cuotas-ortodoncia/plan/:planId - Listar cuotas por plan
router.get('/plan/:planId', getAllByPlan);

// GET /api/odontologia/cuotas-ortodoncia/:id - Obtener cuota por ID
router.get('/:id', getById);

// PUT /api/odontologia/cuotas-ortodoncia/:id/estado - Actualizar estado de cuota
router.put('/:id/estado', updateEstado);

// DELETE /api/odontologia/cuotas-ortodoncia/:id - Eliminar cuota
router.delete('/:id', remove);

export default router;