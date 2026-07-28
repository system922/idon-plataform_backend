import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Obtener certificado desde archivo o variable
const getCert = () => {
  try {
    // 1. Verificar si existe QZ_CERT (variable de entorno)
    if (process.env.QZ_CERT) {
      console.log('[QZ] ✅ Usando QZ_CERT desde variable de entorno');
      return process.env.QZ_CERT;
    }

    // 2. Verificar si existe QZ_CERT_PATH
    const CERT_PATH = process.env.QZ_CERT_PATH || path.resolve(__dirname, '../credentials/override.crt');
    console.log('[QZ] 📂 Intentando leer certificado desde:', CERT_PATH);

    // 3. Verificar si el archivo existe
    if (!fs.existsSync(CERT_PATH)) {
      console.error('[QZ] ❌ El archivo NO existe en:', CERT_PATH);
      throw new Error(`Archivo no encontrado: ${CERT_PATH}`);
    }

    // 4. Leer el archivo
    const cert = fs.readFileSync(CERT_PATH, 'utf8');
    console.log('[QZ] 📄 Tamaño del archivo:', cert.length, 'bytes');
    console.log('[QZ] 📄 Inicio (50 chars):', cert.substring(0, 50));
    console.log('[QZ] 📄 Fin (50 chars):', cert.substring(cert.length - 50));
    
    // 5. Verificar que sea un certificado válido
    if (!cert.includes('-----BEGIN CERTIFICATE-----') || !cert.includes('-----END CERTIFICATE-----')) {
      console.error('[QZ] ❌ El archivo no parece ser un certificado válido');
      throw new Error('Formato de certificado inválido');
    }

    return cert;
  } catch (e) {
    console.error('[QZ] ❌ Error en getCert:', e.message);
    throw e;
  }
};

const getPrivateKey = () => {
  try {
    if (process.env.QZ_KEY) {
      console.log('[QZ] ✅ Usando QZ_KEY desde variable de entorno');
      return process.env.QZ_KEY;
    }

    const KEY_PATH = process.env.QZ_KEY_PATH || path.resolve(__dirname, '../credentials/server.key');
    console.log('[QZ] 📂 Intentando leer clave desde:', KEY_PATH);

    if (!fs.existsSync(KEY_PATH)) {
      console.error('[QZ] ❌ El archivo NO existe en:', KEY_PATH);
      throw new Error(`Archivo no encontrado: ${KEY_PATH}`);
    }

    const key = fs.readFileSync(KEY_PATH, 'utf8');
    console.log('[QZ] 📄 Tamaño de la clave:', key.length, 'bytes');
    return key;
  } catch (e) {
    console.error('[QZ] ❌ Error en getPrivateKey:', e.message);
    throw e;
  }
};

// Ruta pública para el certificado
router.get('/cert', (req, res) => {
  try {
    const cert = getCert();
    console.log('[QZ] ✅ Sirviendo certificado. Tamaño total:', cert.length);
    res.type('text/plain').send(cert);
  } catch (e) {
    console.error('[QZ] ❌ Error en /cert:', e.message);
    res.status(500).send(`Error: ${e.message}`);
  }
});

// Ruta para firmar (con autenticación)
router.post('/sign', (req, res) => {
  try {
    const data = req.body.data;
    if (!data) {
      return res.status(400).json({ error: 'Missing data to sign' });
    }

    console.log('[QZ] ✍️ Firmando datos...');
    const privateKey = getPrivateKey();
    const sign = crypto.createSign('SHA512');
    sign.update(data);
    sign.end();
    const signature = sign.sign(privateKey, 'base64');
    console.log('[QZ] ✅ Firma generada');
    res.json({ signature });
  } catch (e) {
    console.error('[QZ] ❌ Error al firmar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;