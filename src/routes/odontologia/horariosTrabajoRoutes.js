// src/routes/odontologia/horariosTrabajoRoutes.js
import express from 'express';
import {
  getAll,
  getById,
  getByDia,
  initDefaults,
  create,
  update,
  remove,
} from '../../controllers/odontologia/horariosTrabajoController.js';

const router = express.Router();

// GET /api/odontologia/horarios-trabajo - Listar todos
router.get('/', getAll);

// GET /api/odontologia/horarios-trabajo/init - Inicializar por defecto
router.get('/init', initDefaults);

// GET /api/odontologia/horarios-trabajo/dia/:dia - Obtener por día
router.get('/dia/:dia', getByDia);

// GET /api/odontologia/horarios-trabajo/:id - Obtener por ID
router.get('/:id', getById);

// POST /api/odontologia/horarios-trabajo - Crear
router.post('/', create);

// PUT /api/odontologia/horarios-trabajo/:id - Actualizar
router.put('/:id', update);

// DELETE /api/odontologia/horarios-trabajo/:id - Eliminar
router.delete('/:id', remove);

export default router;