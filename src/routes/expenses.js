import express from 'express';
import * as expenseController from '../controllers/expenseController.js';

const router = express.Router();

router.get('/',     expenseController.getAllExpenses);
router.get('/date/:date', expenseController.getExpensesByDate);
router.get('/purchases-by-day', expenseController.getPurchasesTotalByDay);

export default router;