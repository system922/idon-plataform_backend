import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import * as userController from '../controllers/userController.js';

const router = Router();

// GET    /api/core/users
router.get('/',      authMiddleware, userController.getUsers);

// GET    /api/core/users/:id
router.get('/:id',   authMiddleware, userController.getUser);

// POST   /api/core/users
router.post('/',     authMiddleware, userController.createUser);

// PUT    /api/core/users/:id
router.put('/:id',   authMiddleware, userController.updateUser);

// DELETE /api/core/users/:id
router.delete('/:id', authMiddleware, userController.deleteUser);

export default router;