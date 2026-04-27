import { Router } from 'express';
import * as auditLogController from '../controllers/auditLogController.js';

const router = Router();

router.post('/', auditLogController.createAuditLog);
router.get('/', auditLogController.listAuditLogs); // GET /api/audit-log

export default router;