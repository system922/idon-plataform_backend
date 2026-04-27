import express from 'express';
import * as fiscalConfigController from '../controllers/fiscalConfigController.js';

const router = express.Router();

router.get('/', fiscalConfigController.getFiscalConfig);
router.put('/', fiscalConfigController.updateFiscalConfig);

export default router;