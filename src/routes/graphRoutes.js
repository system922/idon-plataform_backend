import express from 'express';
import * as graphController from '../controllers/graphController.js';

const router = express.Router();

router.get('/sales-by-day', graphController.getSalesByDay);
router.get('/purchases-by-day', graphController.getPurchasesByDay);
router.get('/hours-by-day', graphController.getHoursByDay);

export default router;