import express from 'express';
import { submitRegistration } from '../controllers/registerController.js';

const router = express.Router();

// POST /api/register  — público, sin autenticación
router.post('/', submitRegistration);

export default router;
