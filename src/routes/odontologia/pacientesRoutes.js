// src/routes/odontologia/pacientesRoutes.js
import express from 'express';
import {
  getPacientes,
  getPaciente,
  createPaciente,
  updatePaciente,
  deletePaciente,
  searchPacientes
} from '../../controllers/odontologia/pacientesController.js';
import { authMiddleware, businessContextMiddleware } from '../../middleware/auth.js';

const router = express.Router();

// Todas las rutas requieren autenticación y contexto de negocio
router.use(authMiddleware, businessContextMiddleware);

// ============================================================
// RUTAS DE PACIENTES
// ============================================================

// GET /api/odontologia/pacientes - Listar todos los pacientes
router.get('/', getPacientes);

// GET /api/odontologia/pacientes/search - Buscar pacientes
router.get('/search', searchPacientes);

// GET /api/odontologia/pacientes/:id - Obtener un paciente
router.get('/:id', getPaciente);

// POST /api/odontologia/pacientes - Crear paciente
router.post('/', createPaciente);

// PUT /api/odontologia/pacientes/:id - Actualizar paciente
router.put('/:id', updatePaciente);

// DELETE /api/odontologia/pacientes/:id - Eliminar paciente
router.delete('/:id', deletePaciente);

export default router;