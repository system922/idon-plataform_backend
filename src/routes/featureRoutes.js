import express from 'express';
import * as featureController from '../controllers/featureController.js';

const router = express.Router();

router.get('/', featureController.getAllFeatures);
router.get('/:id', featureController.getFeatureById);
router.post('/', featureController.createFeature);
router.put('/:id', featureController.updateFeature);
router.delete('/:id', featureController.deleteFeature);

export default router;
