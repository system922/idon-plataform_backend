import { Router } from 'express';
import * as ctrl from '../controllers/productosController.js';

const router = Router();

router.get('/',           ctrl.getAll);
router.get('/fiscal-rates', ctrl.getFiscalRates);
router.get('/next-code',  ctrl.getNextCode);
router.get('/:id',        ctrl.getById);
router.post('/',          ctrl.create);
router.put('/:id',        ctrl.update);
router.delete('/:id',     ctrl.remove);

export default router;