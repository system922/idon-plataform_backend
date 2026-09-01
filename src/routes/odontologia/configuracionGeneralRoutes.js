// src/routes/odontologia/configuracionGeneralRoutes.js
import express from 'express';
import {
  getConfig,
  updateConfig,
  resetConfig,
} from '../../controllers/odontologia/configuracionGeneralController.js';

const router = express.Router();

// GET /api/odontologia/configuracion-general - Obtener configuración
router.get('/', getConfig);

// GET /api/odontologia/configuracion-general/horario - Obtener solo el horario
router.get('/horario', getHorarioAtencion);  // Nueva ruta

// PUT /api/odontologia/configuracion-general - Actualizar configuración
router.put('/', updateConfig);

// POST /api/odontologia/configuracion-general/reset - Reiniciar a valores por defecto
router.post('/reset', resetConfig);

export default router;