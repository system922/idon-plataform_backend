import express from 'express';
import bcrypt from 'bcrypt';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * POST /api/security/validate-key
 * Body: { key }
 * Busca el usuario email = 'admin_caja' en el esquema activo y valida el hash.
 * OJO: solo busca en el esquema de la conexión actual.
 */
router.post('/validate-key', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ valid: false, error: 'Clave requerida' });

    // Busca el usuario admin_caja en el schema activo (¡tu pool debe estar ya en el contexto del negocio!)
    const { rows } = await query(
      'SELECT password_hash FROM users WHERE email = $1 LIMIT 1',
      ['admin_caja']
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ valid: false, error: 'Usuario admin_caja no encontrado' });
    }

    const hash = rows[0].password_hash;
    const match = await bcrypt.compare(key, hash);
    if (match) return res.json({ valid: true });
    return res.status(401).json({ valid: false, error: 'Clave incorrecta' });

  } catch (err) {
    console.error('validate-key error', err);
    return res.status(500).json({ valid: false, error: 'Error en el servidor' });
  }
});

export default router;