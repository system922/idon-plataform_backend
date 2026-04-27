import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// Soporte para __dirname y __filename en ES Modules:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Ruta a los archivos de certificado y llave privada
const CERT_PATH = process.env.QZ_CERT_PATH || path.resolve(__dirname, '../../credentials/qz-cert.pem');
const KEY_PATH  = process.env.QZ_KEY_PATH  || path.resolve(__dirname, '../../credentials/private-key.pem');

// Logs de depuración para saber qué archivos intenta abrir
console.log('[QZ] Cert path:', CERT_PATH);
console.log('[QZ] Key  path:', KEY_PATH);

/**
 * GET /api/print/cert
 * Entrega el certificado público
 */
router.get('/cert', (req, res) => {
  try {
    const cert = fs.readFileSync(CERT_PATH, 'utf8');
    console.log('[QZ] Archivo certificado CARGADO OK. Primeras 60:', cert.substring(0, 60));
    res.type('text/plain').send(cert);
  } catch (e) {
    console.error('[QZ] ERROR al leer certificado:', e.message);
    res.status(500).send('Missing QZ Tray certificate file');
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

    const privateKey = fs.readFileSync(KEY_PATH, 'utf8');
    console.log('[QZ] Archivo key CARGADO OK. Primeras 60:', privateKey.substring(0, 60));
    const sign = crypto.createSign('SHA512');
    sign.update(data);
    sign.end();
    const signature = sign.sign(privateKey, 'base64');
    res.json({ signature });
  } catch (e) {
    console.error('[QZ] ERROR al leer key o firmar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;