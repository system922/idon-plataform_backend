// src/routes/businessStatus.js
import express from 'express';
import { getBusinessStatus, updateBusinessStatus } from '../controllers/businessStatusController.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/business-status - Obtener estado del negocio (requiere autenticación)
router.get('/', authMiddleware, getBusinessStatus);

// PUT /api/business-status/:businessId - Actualizar estado (solo admin)
router.put('/:businessId', authMiddleware, adminMiddleware, updateBusinessStatus);

export default router;