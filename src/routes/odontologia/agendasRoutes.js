// src/routes/odontologia/agendasRoutes.js
import express from 'express';
import {
  getAll,
  getById,
  create,
  update,
  remove,
  addDiaLibre,
  removeDiaLibre,
  getDiasLibres,
} from '../../controllers/odontologia/agendasController.js';

const router = express.Router();

// GET /api/odontologia/agendas - Listar todos
router.get('/', getAll);

// GET /api/odontologia/agendas/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/agendas - Crear
router.post('/', create);

// PUT /api/odontologia/agendas/:id - Actualizar
router.put('/:id', update);

// DELETE /api/odontologia/agendas/:id - Eliminar
router.delete('/:id', remove);

// ============================================================
// DÍAS LIBRES (sub-rutas)
// ============================================================

// GET /api/odontologia/agendas/:agendaId/dias-libres - Obtener días libres
router.get('/:agendaId/dias-libres', getDiasLibres);

// POST /api/odontologia/agendas/:agendaId/dias-libres - Agregar día libre
router.post('/:agendaId/dias-libres', addDiaLibre);

// DELETE /api/odontologia/agendas/:agendaId/dias-libres/:diaLibreId - Eliminar día libre
router.delete('/:agendaId/dias-libres/:diaLibreId', removeDiaLibre);

export default router;