import express from 'express';
import * as accountingController from '../controllers/accountingReceivable';

const router = express.Router();

// ─── Rutas legacy (ordenes) ─────────────────────────────────
router.get('/receivable', accountingController.getReceivableListLegacy);
router.get('/receivable/:id', accountingController.getReceivableDetailLegacy);
router.post('/receivable/:id/register-payment', accountingController.registerPaymentLegacy);

// ─── Nuevas rutas para accounts_receivable (usadas por AccountingReceivablePage) ──
router.get('/receivables', accountingController.listReceivables);
router.get('/receivables/export', accountingController.exportReceivablesCSV);
router.post('/receivables', accountingController.createReceivable);
router.put('/receivables/:id', accountingController.updateReceivable);
router.delete('/receivables/:id', accountingController.deleteReceivable);
router.post('/receivables/:id/payments', accountingController.addPaymentToReceivable);

// ─── Clientes para el módulo de contabilidad ─────────────────
router.get('/customers', accountingController.listAccountingCustomers);
router.post('/customers', accountingController.createAccountingCustomer);
router.put('/customers/:id', accountingController.updateAccountingCustomer);
router.delete('/customers/:id', accountingController.deleteAccountingCustomer);

export default router;