// src/routes/odontologia/gruposAgendasRoutes.js
import express from 'express';
import {
  getAll,
  getById,
  create,
  update,
  remove,
} from '../../controllers/odontologia/gruposAgendasController.js';

const router = express.Router();

// GET /api/odontologia/grupos-agendas - Listar todos
router.get('/', getAll);

// GET /api/odontologia/grupos-agendas/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/grupos-agendas - Crear
router.post('/', create);

// PUT /api/odontologia/grupos-agendas/:id - Actualizar
router.put('/:id', update);

// DELETE /api/odontologia/grupos-agendas/:id - Eliminar
router.delete('/:id', remove);

export default router;