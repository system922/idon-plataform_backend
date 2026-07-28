import express from 'express';
import crypto from 'crypto';

const router = express.Router();

// Obtener certificado y clave desde variables de entorno o archivos
const getCert = () => {
  // Primero intentar desde variable de entorno
  if (process.env.QZ_CERT) {
    return process.env.QZ_CERT;
  }
  // Fallback a archivo (para desarrollo local)
  const fs = require('fs');
  const path = require('path');
  const CERT_PATH = process.env.QZ_CERT_PATH || path.resolve(__dirname, '../credentials/override.crt');
  return fs.readFileSync(CERT_PATH, 'utf8');
};

const getPrivateKey = () => {
  // Primero intentar desde variable de entorno
  if (process.env.QZ_KEY) {
    return process.env.QZ_KEY;
  }
  // Fallback a archivo (para desarrollo local)
  const fs = require('fs');
  const path = require('path');
  const KEY_PATH = process.env.QZ_KEY_PATH || path.resolve(__dirname, '../credentials/server.key');
  return fs.readFileSync(KEY_PATH, 'utf8');
};

/**
 * GET /api/print/cert
 * Entrega el certificado público
 */
router.get('/cert', (req, res) => {
  try {
    const cert = getCert();
    res.type('text/plain').send(cert);
  } catch (e) {
    console.error('[QZ] ERROR al leer certificado:', e.message);
    res.status(500).send('Missing QZ Tray certificate');
  }
});

/**
 * POST /api/print/sign
 * Firma peticiones QZ con la clave privada
 */
router.post('/sign', (req, res) => {
  try {
    const data = req.body.data;
    if (!data) return res.status(400).json({ error: 'Missing data to sign' });

    const privateKey = getPrivateKey();
    const sign = crypto.createSign('SHA512');
    sign.update(data);
    sign.end();
    const signature = sign.sign(privateKey, 'base64');
    res.json({ signature });
  } catch (e) {
    console.error('[QZ] ERROR al firmar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;