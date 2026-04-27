import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/customers
 * Lists all customers from the tenant schema.
 * Headers: Authorization, X-DB-Name
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const result = await query(
      `SELECT id, name, email, phone, document_number, created_at
       FROM "${schema}".customers
       ORDER BY name ASC`
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/customers/by-document?document_number=xxx&document_type=cedula|ruc
 * Busca un cliente por número y tipo de documento.
 */
router.get('/by-document', authMiddleware, async (req, res) => {
  try {
    const { document_number, document_type } = req.query;
    if (!document_number) return res.status(400).json({ error: 'document_number requerido' });

    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT id, name, email, phone, document_number, document_type, address, notes
       FROM "${schema}".customers
       WHERE document_number = $1
       LIMIT 1`,
      [document_number]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/customers/:id
 * Actualiza nombre y/o teléfono de un cliente existente.
 */
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone } = req.body;

    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `UPDATE "${schema}".customers
       SET name       = COALESCE($1, name),
           phone      = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, email, phone, document_number, document_type`,
      [name || null, phone || null, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/clientes?cedula=xxx
 * Searches a customer by document number (cédula).
 * Headers: Authorization, X-DB-Name
 */
router.get('/cedula', authMiddleware, async (req, res) => {
  try {
    const { cedula } = req.query;
    if (!cedula) return res.status(400).json({ error: 'cedula es requerida' });

    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT id, name, email, phone, document_number
       FROM "${schema}".customers
       WHERE document_number = $1
       LIMIT 1`,
      [cedula]
    );

    if (result.rows.length === 0) return res.json([]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/clientes
 * Creates a new customer in the tenant schema.
 * Headers: Authorization, X-DB-Name
 * Body: { nombre, cedula, email?, phone? }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { nombre, cedula, email, phone, tipo_documento } = req.body;
    if (!nombre || !cedula) {
      return res.status(400).json({ error: 'nombre y cedula son requeridos' });
    }

    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    // Chequea si ya existe:
    const existing = await query(
      `SELECT id, name, email, phone, document_number, document_type FROM "${schema}".customers WHERE document_number = $1 LIMIT 1`,
      [cedula]
    );
    if (existing.rows.length > 0) return res.json(existing.rows[0]);

    // Detecta o usa el tipo correcto:
    let document_type = tipo_documento;
    if (!document_type) {
      document_type = (cedula.length === 13) ? 'ruc'
                     : (cedula.length === 10) ? 'cedula'
                     : 'otro';
    }

    const result = await query(
      `INSERT INTO "${schema}".customers
           (name, email, phone, document_number, document_type, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, name, email, phone, document_number, document_type`,
      [nombre, email || null, phone || null, cedula, document_type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
