// ========== backend/routes/user.routes.js ==========

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { validateUniqueEmail } from '../middleware/validateUserUniqueness.js';
import * as userController from '../controllers/userController.js';

const router = Router();

// GET    /api/core/users
router.get('/', authMiddleware, userController.getUsers);

// GET    /api/core/users/:id
router.get('/:id', authMiddleware, userController.getUser);

// POST   /api/core/users - ✅ CON VALIDACIÓN DE EMAIL
router.post('/', authMiddleware, validateUniqueEmail, userController.createUser);

// PUT    /api/core/users/:id - ✅ CON VALIDACIÓN DE EMAIL
router.put('/:id', authMiddleware, validateUniqueEmail, userController.updateUser);

// DELETE /api/core/users/:id
router.delete('/:id', authMiddleware, userController.deleteUser);

export default router;