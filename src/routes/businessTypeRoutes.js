import express from 'express';
import * as businessTypeController from '../controllers/businessTypeController.js';

const router = express.Router();

// GET /api/admin/business-types
router.get('/business-types', businessTypeController.getAllBusinessTypes);

// GET /api/admin/business-types/:id
router.get('/business-types/:id', businessTypeController.getBusinessTypeById);

// POST /api/admin/business-types
router.post('/business-types', businessTypeController.createBusinessType);

// PUT /api/admin/business-types/:id
router.put('/business-types/:id', businessTypeController.updateBusinessType);

// DELETE /api/admin/business-types/:id
router.delete('/business-types/:id', businessTypeController.deleteBusinessType);

export default router;