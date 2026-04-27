import express from 'express';
import * as businessTypeController from '../controllers/businessTypeController.js';

const router = express.Router();

router.get('/', businessTypeController.getAllBusinessTypes);
router.get('/:id', businessTypeController.getBusinessTypeById);
router.post('/', businessTypeController.createBusinessType);
router.put('/:id', businessTypeController.updateBusinessType);
router.delete('/:id', businessTypeController.deleteBusinessType);

export default router;
