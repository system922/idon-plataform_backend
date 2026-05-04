import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import * as discountController from '../controllers/discountController.js';

const router = Router();

// GET    /api/discounts
router.get('/', authMiddleware, discountController.getDiscounts);

// GET    /api/discounts/:id
router.get('/:id', authMiddleware, discountController.getDiscount);

// POST   /api/discounts
router.post('/', authMiddleware, discountController.createDiscount);

// PUT    /api/discounts/:id
router.put('/:id', authMiddleware, discountController.updateDiscount);

// DELETE /api/discounts/:id
router.delete('/:id', authMiddleware, discountController.deleteDiscount);

export default router;