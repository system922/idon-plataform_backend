import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const hashText = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

// Obtener certificado desde archivo o variable
const getCert = () => {
  try {
    if (process.env.QZ_CERT) {
      return process.env.QZ_CERT;
    }

    const CERT_PATH = process.env.QZ_CERT_PATH || path.resolve(__dirname, '../credentials/override.crt');
    console.log('[QZ] 📂 Intentando leer certificado desde:', CERT_PATH);

    if (!fs.existsSync(CERT_PATH)) {
      console.error('[QZ] ❌ El archivo NO existe en:', CERT_PATH);
      throw new Error(`Archivo no encontrado: ${CERT_PATH}`);
    }

    const cert = fs.readFileSync(CERT_PATH, 'utf8');
  
    
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
      return process.env.QZ_KEY;
    }

    const KEY_PATH = process.env.QZ_KEY_PATH || path.resolve(__dirname, '../credentials/server.key');

    if (!fs.existsSync(KEY_PATH)) {
      console.error('[QZ] ❌ El archivo NO existe en:', KEY_PATH);
      throw new Error(`Archivo no encontrado: ${KEY_PATH}`);
    }

    const key = fs.readFileSync(KEY_PATH, 'utf8');
    return key;
  } catch (e) {
    console.error('[QZ] ❌ Error en getPrivateKey:', e.message);
    throw e;
  }
};

router.get('/cert', (req, res) => {
  try {
    const cert = getCert();
    const certificate = new crypto.X509Certificate(cert);
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    console.log('[QZ] /cert OK', {
      subject: certificate.subject,
      fingerprint256: certificate.fingerprint256,
      validTo: certificate.validTo,
    });
    res.type('text/plain').send(cert);
  } catch (e) {
    console.error('[QZ] ❌ Error en /cert:', e.message);
    res.status(500).send(`Error: ${e.message}`);
  }
});

router.post('/sign', (req, res) => {
  try {
    const data = req.body.data;
    if (!data) {
      return res.status(400).json({ error: 'Missing data to sign' });
    }

    const privateKey = getPrivateKey();

    const cert = new crypto.X509Certificate(getCert());
    const publicKey = cert.publicKey;
    const sign = crypto.createSign('SHA512');
    sign.update(data);
    sign.end();
    const signature = sign.sign(privateKey, 'base64');

    const verify = crypto.createVerify('SHA512');
    verify.update(data);
    verify.end();
    const valid = verify.verify(publicKey, signature, 'base64');
    console.log('[QZ] /sign', {
      dataHash: hashText(data),
      dataLength: String(data).length,
      signatureLength: signature.length,
      certificateFingerprint256: cert.fingerprint256,
      signatureValidWithCertificate: valid,
    });

    if (!valid) {
      return res.status(500).json({ error: 'La firma no coincide con el certificado QZ configurado' });
    }

    res.json({ signature });
  } catch (e) {
    console.error('[QZ] ❌ Error al firmar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;