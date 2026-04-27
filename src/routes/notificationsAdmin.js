import express from 'express';
import { getAdminNotificationsController } from '../controllers/notificationsAdminController.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/notifications-admin/all?filterType=pending
router.get('/all', authMiddleware, adminMiddleware, getAdminNotificationsController);

export default router;
