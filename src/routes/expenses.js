import express from 'express';
import * as expenseController from '../controllers/expenseController.js';

const router = express.Router();

router.get('/',          expenseController.getAllExpenses);      // soporta date_from, date_to, category_id
router.get('/date/:date', expenseController.getExpensesByDate);
router.get('/purchases-by-day', expenseController.getPurchasesTotalByDay);
router.get('/dashboard/summary', expenseController.getExpensesSummaryForDashboard);
router.post('/',         expenseController.createExpense);
router.put('/:id',       expenseController.updateExpense);
router.delete('/:id',    expenseController.deleteExpense);

export default router;