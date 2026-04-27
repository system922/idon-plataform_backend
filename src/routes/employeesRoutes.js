// routes/employees.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/employees
 * List all employees (optionally filter by active, etc)
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema)
      return res.status(400).json({ error: 'Business context required' });

    const q = `
      SELECT 
        id, user_id, full_name, email, phone, position, department, 
        document_number, salary, hired_at, status, created_at, updated_at
      FROM "${schema}".employees
      ORDER BY created_at DESC
    `;
    const result = await query(q);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/employees/:id
 * Get one employee by id
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const q = `SELECT * FROM "${schema}".employees WHERE id = $1 LIMIT 1`;
    const result = await query(q, [id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/employees
 * Create new employee
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema)
      return res.status(400).json({ error: 'Business context required' });

    const {
      user_id,
      full_name,
      email,
      phone,
      position,
      department,
      document_number,
      salary,
      hired_at,
      status
    } = req.body;

    const q = `
      INSERT INTO "${schema}".employees
        (user_id, full_name, email, phone, position, department, document_number, salary, hired_at, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'active'))
      RETURNING *
    `;
    const params = [
      user_id || null,
      full_name,
      email,
      phone,
      position,
      department,
      document_number,
      salary || 0,
      hired_at,
      status,
    ];
    const result = await query(q, params);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/employees/:id
 * Update employee
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id } = req.params;
    const {
      user_id,
      full_name,
      email,
      phone,
      position,
      department,
      document_number,
      salary,
      hired_at,
      status
    } = req.body;

    const q = `
      UPDATE "${schema}".employees SET
        user_id = $1,
        full_name = $2,
        email = $3,
        phone = $4,
        position = $5,
        department = $6,
        document_number = $7,
        salary = $8,
        hired_at = $9,
        status = $10,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *
    `;
    const params = [
      user_id || null,
      full_name,
      email,
      phone,
      position,
      department,
      document_number,
      salary || 0,
      hired_at,
      status,
      id
    ];
    const result = await query(q, params);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/employees/:id
 * Delete an employee
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id } = req.params;

    const q = `DELETE FROM "${schema}".employees WHERE id = $1`;
    await query(q, [id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;