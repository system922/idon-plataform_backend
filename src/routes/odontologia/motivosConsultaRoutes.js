// src/routes/odontologia/motivosConsultaRoutes.js
import express from 'express';
import {
  getAll,
  getById,
  create,
  update,
  remove,
} from '../../controllers/odontologia/motivosConsultaController.js';

const router = express.Router();

// GET /api/odontologia/motivos-consulta - Listar todos
router.get('/', getAll);

// GET /api/odontologia/motivos-consulta/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/motivos-consulta - Crear
router.post('/', create);

// PUT /api/odontologia/motivos-consulta/:id - Actualizar
router.put('/:id', update);

// DELETE /api/odontologia/motivos-consulta/:id - Eliminar
router.delete('/:id', remove);

export default router;