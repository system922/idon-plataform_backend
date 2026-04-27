import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Lista de registros de horas
router.get('/', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const result = await query(
    `SELECT * FROM "${schema}".worked_hours ORDER BY worked_date DESC`
  );
  res.json(result.rows);
});

// Registrar horas trabajadas
router.post('/', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { collaborator_id, worked_date, hours } = req.body;
  const result = await query(
    `INSERT INTO "${schema}".worked_hours (collaborator_id, worked_date, hours)
     VALUES ($1, $2, $3) RETURNING *`,
    [collaborator_id, worked_date, hours]
  );
  res.json(result.rows[0]);
});

// Detalle por ID
router.get('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  const result = await query(
    `SELECT * FROM "${schema}".worked_hours WHERE id=$1`,
    [id]
  );
  res.json(result.rows[0]);
});

// Editar registro
router.put('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  const { hours } = req.body;
  await query(
    `UPDATE "${schema}".worked_hours SET hours=$1 WHERE id=$2`,
    [hours, id]
  );
  res.json({ success: true });
});

// Eliminar registro
router.delete('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  await query(
    `DELETE FROM "${schema}".worked_hours WHERE id=$1`,
    [id]
  );
  res.json({ success: true });
});

// Gráfico: horas trabajadas por día
router.get('/by-day', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const result = await query(
    `SELECT to_char(worked_date, 'Dy') as day, SUM(hours)::float as hours
     FROM "${schema}".worked_hours
     GROUP BY day
     ORDER BY MIN(worked_date)`
  );
  res.json(result.rows);
});

export default router;