import express from 'express';
import * as billingHistoryController from '../controllers/billingHistoryController.js';

const router = express.Router();

router.get('/', billingHistoryController.listBillingHistory);

export default router;