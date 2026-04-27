/**
 * einvoicingService.js
 * Servicio central para emisión y gestión de facturas electrónicas SRI.
 * Usa osodreamer-sri-xml-signer (reemplaza open-factura).
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import { v2 as cloudinary } from 'cloudinary';
import {
  generateXmlInvoice,
  signXml,
  validateXml,
  authorizeXml,
} from 'osodreamer-sri-xml-signer';
import { query, getClient } from '../config/database.js';
import logger from '../utils/logger.js';
import { sendInvoice as sendWhatsapp } from './whatsappService.js';

cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads/signatures');

// ------------------- Helpers --------------------
function pad(n, len) {
  return String(n).padStart(len, '0');
}
// Código porcentaje IVA (número, no string) para la librería osodreamer
function ivaCode(rate) {
  if (rate === 0)  return 0;  // 0%
  if (rate === 5)  return 5;  // 5%
  if (rate === 8)  return 8;  // diferenciado
  if (rate === 12) return 2;  // 12%
  return 4;                   // 15% default actual Ecuador
}

// ------------------- CONFIG Y SIGNATURE -------------------
export async function getConfig(schema) {
  const { rows } = await query(`SELECT * FROM "${schema}".einvoice_config LIMIT 1`);
  return rows[0] || null;
}
export async function saveConfig(schema, data) {
  const { rows } = await query(
    `UPDATE "${schema}".einvoice_config SET
       ruc                       = COALESCE($1,  ruc),
       razon_social              = COALESCE($2,  razon_social),
       nombre_comercial          = COALESCE($3,  nombre_comercial),
       direccion_matriz          = COALESCE($4,  direccion_matriz),
       direccion_establecimiento = COALESCE($5,  direccion_establecimiento),
       contribuyente_especial    = COALESCE($6,  contribuyente_especial),
       obligado_contabilidad     = COALESCE($7,  obligado_contabilidad),
       ambiente                  = COALESCE($8,  ambiente),
       serie_estab               = COALESCE($9,  serie_estab),
       serie_pto_emision         = COALESCE($10, serie_pto_emision),
       secuencial_actual         = COALESCE($11, secuencial_actual),
       p12_path                  = COALESCE($12, p12_path),
       p12_password              = COALESCE($13, p12_password),
       cert_valid_until          = COALESCE($14, cert_valid_until),
       logo_url                  = COALESCE($15, logo_url),
       updated_at                = NOW()
     RETURNING *`,
    [
      data.ruc, data.razon_social, data.nombre_comercial, data.direccion_matriz,
      data.direccion_establecimiento, data.contribuyente_especial, data.obligado_contabilidad,
      data.ambiente, data.serie_estab, data.serie_pto_emision,
      data.secuencial_actual != null ? parseInt(data.secuencial_actual, 10) : null,
      data.p12_path, data.p12_password, data.cert_valid_until,
      data.logo_url ?? null,
    ]
  );
  return rows[0];
}

export async function uploadLogo(schema, buffer) {
  const url = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `idon/${schema}`, public_id: 'business_logo', overwrite: true, resource_type: 'image' },
      (err, result) => { if (err) reject(err); else resolve(result.secure_url); }
    );
    stream.end(buffer);
  });
  await query(
    `UPDATE "${schema}".einvoice_config SET logo_url = $1, updated_at = NOW()`,
    [url]
  );
  return url;
}
export async function saveSignatureFile(schema, buffer) {
  const dir = path.join(UPLOADS_DIR, schema);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'firma.p12');
  await writeFile(filePath, buffer);
  return filePath;
}

// ------------------- CORE: Emisión -------------------
export async function emitInvoice(schema, opts) {
  const cfg = await getConfig(schema);
  if (!cfg)          throw new Error('Configuración de facturación electrónica no encontrada');
  if (!cfg.p12_path) throw new Error('No hay firma electrónica cargada');
  if (!cfg.ruc)      throw new Error('RUC del emisor no configurado');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Incrementar secuencial atómicamente
    const { rows: seqRows } = await client.query(
      `UPDATE "${schema}".einvoice_config
         SET secuencial_actual = secuencial_actual + 1
       RETURNING secuencial_actual - 1 AS seq`
    );
    const secuencial = seqRows[0].seq;

    const now        = new Date();
    const estab      = cfg.serie_estab        || '001';
    const ptoEmi     = cfg.serie_pto_emision  || '001';
    const ambiente   = cfg.ambiente           || '1';
    const envEnum    = parseInt(ambiente, 10); // 1=pruebas, 2=producción
    const envStr     = envEnum === 2 ? 'prod' : 'test'; // SRI_URLS usa 'test'/'prod'

    const invoiceNumber = `${estab}-${ptoEmi}-${pad(secuencial, 9)}`;
    const customer      = opts.customer || {};
    const tipoId        = customer.tipo_identificacion || '07';
    const idComprador   = customer.ruc  || '9999999999999';
    const razonComprador= customer.name || 'CONSUMIDOR FINAL';
    const ivaRate       = parseFloat(opts.iva_rate ?? 15);
    const subtotalNum   = parseFloat(opts.subtotal  || 0);
    const ivaNum        = parseFloat(opts.iva_amount|| 0);
    const totalNum      = parseFloat(opts.total     || 0);

    const ivaCod = ivaCode(ivaRate);

    const detalleItems = (opts.items || []).map((item) => {
      const qty      = parseFloat(item.qty || item.quantity || 1);
      const unitPrice= parseFloat(item.unit_price || 0);
      const lineTotal= parseFloat((item.subtotal || item.line_total || (unitPrice * qty) || 0).toFixed(2));
      const ivaItem  = parseFloat((lineTotal * ivaRate / 100).toFixed(2));
      return {
        codigoPrincipal:         item.code || 'PROD',
        descripcion:             item.description || item.name || 'Producto',
        cantidad:                qty,
        precioUnitario:          unitPrice,
        descuento:               0,
        precioTotalSinImpuesto:  lineTotal,
        impuestos: {
          impuesto: [{
            codigo:           2,        // TAX_CODE_ENUM.VAT — número
            codigoPorcentaje: ivaCod,   // número: 4=15%, 2=12%, etc.
            tarifa:           ivaRate,  // porcentaje real
            baseImponible:    lineTotal,
            valor:            ivaItem,
          }],
        },
      };
    });

    // Construir el comprobante — formato que acepta osodreamer-sri-xml-signer
    const comprobante = {
      infoTributaria: {
        ruc:         cfg.ruc,
        ambiente:    envEnum,
        dirMatriz:   cfg.direccion_matriz || 'Ecuador',
        estab,
        ptoEmi,
        secuencial:  pad(secuencial, 9),
        razonSocial: cfg.razon_social,
        ...(cfg.nombre_comercial ? { nombreComercial: cfg.nombre_comercial } : {}),
      },
      infoFactura: {
        fechaEmision:                now,
        dirEstablecimiento:          cfg.direccion_establecimiento || cfg.direccion_matriz || 'Ecuador',
        ...(cfg.contribuyente_especial ? { contribuyenteEspecial: cfg.contribuyente_especial } : {}),
        obligadoContabilidad:        cfg.obligado_contabilidad ? 'SI' : 'NO',
        tipoIdentificacionComprador: tipoId,
        razonSocialComprador:        razonComprador,
        identificacionComprador:     idComprador,
        totalSinImpuestos:           subtotalNum,
        totalDescuento:              0,
        propina:                     0,
        importeTotal:                totalNum,
        moneda:                      'USD',
        totalConImpuestos: {
          totalImpuesto: [{
            codigo:           2,
            codigoPorcentaje: ivaCod,
            baseImponible:    subtotalNum,
            valor:            ivaNum,
          }],
        },
        pagos: {
          pago: [{
            formaPago: opts.forma_pago || '01',
            total:     totalNum,
          }],
        },
      },
      detalles: {
        detalle: detalleItems,
      },
    };

    // 1. Generar XML
    const { generatedXml } = await generateXmlInvoice(comprobante);
    const claveMatch  = generatedXml.match(/<claveAcceso>([^<]+)<\/claveAcceso>/);
    const claveAcceso = claveMatch?.[1] || '';

    // 2. Firmar XML
    const p12Buffer = await readFile(cfg.p12_path);
    const signedXml = await signXml({
      p12Buffer:  new Uint8Array(p12Buffer),
      password:   cfg.p12_password || '',
      xmlBuffer:  new TextEncoder().encode(generatedXml),
    });

    // 3. Enviar al SRI
    let status     = 'pendiente';
    let sriMessage = null;
    let authNumber = null;
    let authDate   = null;
    let sriJson    = null;

    try {
      const recResult = await validateXml({
        xml: new TextEncoder().encode(signedXml),
        env: envStr,
      });
      logger.info({ recResult }, 'SRI recepción');

      if (recResult?.estado === 'RECIBIDA') {
        const authResult = await authorizeXml({
          claveAcceso,
          env: envStr,
        });
        logger.info({ authResult }, 'SRI autorización');
        sriJson = authResult;

        if (authResult?.estadoAutorizacion === 'AUTORIZADO') {
          status     = 'autorizada';
          authNumber = authResult.claveAcceso || claveAcceso;
          authDate   = authResult.fechaAutorizacion ? new Date(authResult.fechaAutorizacion) : new Date();
        } else {
          status     = 'rechazada';
          sriMessage = (authResult?.mensajes || []).map(m => m.mensaje).join(' | ')
                     || authResult?.estadoAutorizacion
                     || 'Rechazada por el SRI';
        }
      } else {
        status     = 'pendiente';
        sriMessage = recResult?.mensaje || 'No recibida por el SRI';
      }
    } catch (sriErr) {
      logger.warn({ err: sriErr.message }, 'SRI error — guardando como pendiente');
      status     = 'pendiente';
      sriMessage = sriErr.message;
    }

    const phone = customer.phone || opts.customer_phone || null;

    const { rows } = await client.query(
      `INSERT INTO "${schema}".einvoices
         (order_id, invoice_number, access_key, auth_number,
          customer_id, customer_name, customer_ruc, customer_email, customer_phone,
          subtotal, iva_amount, total, items,
          signed_xml, status, sri_message, sri_json, emission_date, auth_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        opts.order_id || null, invoiceNumber, claveAcceso, authNumber,
        customer.id   || null, razonComprador, idComprador, customer.email || null, phone,
        subtotalNum.toFixed(2), ivaNum.toFixed(2), totalNum.toFixed(2),
        JSON.stringify(opts.items || []),
        signedXml,
        status, sriMessage, sriJson ? JSON.stringify(sriJson) : null,
        now, authDate,
      ]
    );

    await client.query('COMMIT');
    const savedInvoice = rows[0];

    // Envío por WhatsApp (no bloquea si falla)
    if (phone && savedInvoice.status === 'autorizada') {
      generateInvoicePdf(schema, savedInvoice.id)
        .then(pdfBuf => sendWhatsapp(phone, pdfBuf, savedInvoice))
        .catch(e => logger.warn({ err: e.message }, 'WhatsApp send failed (non-blocking)'));
    }

    return savedInvoice;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ------------------- RESEND -------------------
export async function resendInvoice(schema, invoiceId) {
  const cfg = await getConfig(schema);
  if (!cfg?.p12_path) throw new Error('No hay firma electrónica cargada');

  const { rows } = await query(
    `SELECT * FROM "${schema}".einvoices WHERE id = $1`, [invoiceId]
  );
  const inv = rows[0];
  if (!inv)          throw new Error('Factura no encontrada');
  if (!inv.signed_xml) throw new Error('XML firmado no disponible');

  const ambiente  = cfg.ambiente || '1';
  const envStr    = parseInt(ambiente, 10) === 2 ? 'prod' : 'test';
  let status, authNumber, authDate, sriMessage, sriJson;

  try {
    await validateXml({
      xml: new TextEncoder().encode(inv.signed_xml),
      env: envStr,
    });

    const authResult = await authorizeXml({
      claveAcceso: inv.access_key,
      env: envStr,
    });
    sriJson = authResult;

    if (authResult?.estadoAutorizacion === 'AUTORIZADO') {
      status     = 'autorizada';
      authNumber = authResult.claveAcceso || inv.access_key;
      authDate   = authResult.fechaAutorizacion ? new Date(authResult.fechaAutorizacion) : new Date();
      sriMessage = null;
    } else {
      status     = 'rechazada';
      authNumber = null;
      authDate   = null;
      sriMessage = (authResult?.mensajes || []).map(m => m.mensaje).join(' | ')
                 || authResult?.estadoAutorizacion || 'Rechazada por el SRI';
    }
  } catch (sriErr) {
    status     = 'error';
    sriMessage = sriErr.message;
  }

  const { rows: updated } = await query(
    `UPDATE "${schema}".einvoices
       SET status = $1, auth_number = $2, auth_date = $3,
           sri_message = $4, sri_json = $5, updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [status, authNumber, authDate, sriMessage, sriJson ? JSON.stringify(sriJson) : null, invoiceId]
  );
  return updated[0];
}

// ------------------- HISTORIAL -------------------
export async function listInvoices(schema, { limit = 50, status } = {}) {
  const where  = status ? `WHERE status = $1` : '';
  const params = status ? [status] : [];
  const { rows } = await query(
    `SELECT id, invoice_number, access_key, auth_number,
            customer_id, customer_name, customer_ruc, customer_email, customer_phone,
            subtotal, iva_amount, total,
            status, sri_message, sri_json,
            emission_date, auth_date, created_at
       FROM "${schema}".einvoices
       ${where}
       ORDER BY created_at DESC
       LIMIT ${parseInt(limit, 10)}`,
    params
  );
  return rows;
}

// ------------------- WHATSAPP MANUAL -------------------
export async function sendInvoiceWhatsapp(schema, invoiceId, phone) {
  const { rows } = await query(`SELECT * FROM "${schema}".einvoices WHERE id = $1`, [invoiceId]);
  const inv = rows[0];
  if (!inv)                     throw new Error('Factura no encontrada');
  if (inv.status !== 'autorizada') throw new Error('Solo se pueden enviar por WhatsApp facturas autorizadas por el SRI');
  const pdfBuf = await generateInvoicePdf(schema, invoiceId);
  await sendWhatsapp(phone, pdfBuf, inv);
  return inv;
}

// ─── Parseo del XML firmado para RIDE PDF ─────────────────────────────────────
async function parseFacturaFromXml(xmlText) {
  const { parseStringPromise } = await import('xml2js');
  const parsed = await parseStringPromise(xmlText, { explicitArray: false, ignoreAttrs: false });

  const root = parsed['factura'] || parsed['ns0:factura'] || parsed;
  const factura = root?.infoTributaria
    ? root
    : parsed?.factura
    ?? Object.values(parsed).find(v => v?.infoTributaria)
    ?? root;

  const str = v => (typeof v === 'object' ? v?._ ?? Object.values(v)[0] : v) ?? '';
  const num = v => parseFloat(str(v)) || 0;

  const it  = factura?.infoTributaria ?? {};
  const inf = factura?.infoFactura    ?? {};

  let rawDetalles = factura?.detalles?.detalle ?? [];
  if (!Array.isArray(rawDetalles)) rawDetalles = [rawDetalles];

  const items = rawDetalles.map(d => {
    let rawImp = d?.impuestos?.impuesto ?? [];
    if (!Array.isArray(rawImp)) rawImp = [rawImp];
    const ivaImp = rawImp.find(i => str(i?.codigo) === '2') || rawImp[0] || {};
    return {
      codigoPrincipal: str(d?.codigoPrincipal),
      codigoAuxiliar:  str(d?.codigoAuxiliar),
      descripcion:     str(d?.descripcion),
      cantidad:        num(d?.cantidad),
      unitPrice:       num(d?.precioUnitario),
      descuento:       num(d?.descuento),
      lineTotal:       num(d?.precioTotalSinImpuesto),
      ivaRate:         num(ivaImp?.tarifa) || 15,
      ivaValue:        num(ivaImp?.valor),
    };
  });

  return {
    razonSocial:    str(it?.razonSocial),
    ruc:            str(it?.ruc),
    nombreComercial:str(it?.nombreComercial),
    dirMatriz:      str(it?.dirMatriz),
    dirEstab:       str(inf?.dirEstablecimiento),
    claveAcceso:    str(it?.claveAcceso),
    ambiente:       str(it?.ambiente),
    estab:          str(it?.estab),
    ptoEmi:         str(it?.ptoEmi),
    secuencial:     str(it?.secuencial),
    fechaEmision:   str(inf?.fechaEmision),
    tipoIdComprador:str(inf?.tipoIdentificacionComprador),
    razonComprador: str(inf?.razonSocialComprador),
    idComprador:    str(inf?.identificacionComprador),
    subtotal:       num(inf?.totalSinImpuestos),
    iva:            num(inf?.totalConImpuestos?.totalImpuesto?.valor
                       ?? inf?.totalConImpuestos?.totalImpuesto?.[0]?.valor),
    total:          num(inf?.importeTotal),
    formaPago:      str(inf?.pagos?.pago?.formaPago ?? inf?.pagos?.pago?.[0]?.formaPago),
    items,
  };
}

async function generateBarcode(text) {
  try {
    const bwipjs = await import('bwip-js');
    const fn = bwipjs.default?.toBuffer || bwipjs.toBuffer;
    return await fn({ bcid: 'code128', text, scale: 2, height: 10, includetext: false, backgroundcolor: 'ffffff' });
  } catch { return null; }
}

// ------------------- GENERACIÓN PDF (RIDE) -------------------
export async function generateInvoicePdf(schema, invoiceId) {
  const { rows: invRows } = await query(
    `SELECT * FROM "${schema}".einvoices WHERE id = $1`, [invoiceId]
  );
  const inv = invRows[0];
  if (!inv)          throw new Error('Factura no encontrada');
  if (!inv.signed_xml) throw new Error('XML firmado no disponible para esta factura');

  const d   = await parseFacturaFromXml(inv.signed_xml);
  const cfg = await getConfig(schema);

  // Download logo from Cloudinary if set
  let logoBuf = null;
  if (cfg?.logo_url) {
    try {
      const res = await fetch(cfg.logo_url);
      if (res.ok) logoBuf = Buffer.from(await res.arrayBuffer());
    } catch { /* logo optional — continue without it */ }
  }

  const razonSocial  = d.razonSocial  || cfg?.razon_social     || 'EMISOR';
  const ruc          = d.ruc          || cfg?.ruc               || '-';
  const dirMatriz    = d.dirMatriz    || cfg?.direccion_matriz  || '';
  const nroFactura   = inv.invoice_number || `${d.estab}-${d.ptoEmi}-${d.secuencial}`;
  const esProduccion = d.ambiente === '2';

  const subtotal = d.subtotal || parseFloat(inv.subtotal   || 0);
  const iva      = d.iva      || parseFloat(inv.iva_amount  || 0);
  const total    = d.total    || parseFloat(inv.total       || 0);

  const FORMA_PAGO_LABELS = {
    '01': 'SIN UTILIZACIÓN DEL SISTEMA FINANCIERO',
    '15': 'COMPENSACIÓN DE DEUDAS',
    '16': 'TARJETA DE DÉBITO',
    '17': 'DINERO ELECTRÓNICO',
    '18': 'TARJETA PREPAGO',
    '19': 'TARJETA DE CRÉDITO',
    '20': 'OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO',
    '21': 'ENDOSO DE TÍTULOS',
  };
  const formaPagoLabel = FORMA_PAGO_LABELS[d.formaPago] || (d.formaPago || 'SIN UTILIZACIÓN DEL SISTEMA FINANCIERO');

  const claveAcceso = d.claveAcceso || inv.access_key || '';
  const barcodeBuf  = await generateBarcode(claveAcceso);

  // Per-IVA-rate subtotals from parsed items
  const subtotalByRate = {};
  for (const item of d.items) {
    const r = item.ivaRate;
    subtotalByRate[r] = (subtotalByRate[r] || 0) + item.lineTotal;
  }
  const ivaRates = Object.keys(subtotalByRate).map(Number).sort((a, b) => b - a);
  const mainRate  = ivaRates[0] ?? 15;

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M    = 30;
    const PW   = doc.page.width;
    const W    = PW - M * 2;
    const BK   = '#000000';
    const GR   = '#666666';
    const LGR  = '#eeeeee';
    const VLGR = '#f9f9f9';
    const WHT  = '#ffffff';
    const BLU  = '#1a56db';
    const BDR  = '#999999';

    const bord = (x, y2, w, h, lw = 0.5) =>
      doc.rect(x, y2, w, h).lineWidth(lw).stroke(BDR);
    const fill = (x, y2, w, h, color) =>
      doc.rect(x, y2, w, h).fill(color);

    let y = M;

    // ══════════════════════════ HEADER ═══════════════════════════════════════
    const leftW  = Math.round(W * 0.52);
    const rightW = W - leftW - 4;
    const rightX = M + leftW + 4;
    const hH     = 178;

    bord(rightX, y, rightW, hH, 0.8);

    // ── Izquierda: logo + datos emisor ──────────────────────────────────────
    const LOGO_FIT = 75;
    if (logoBuf) {
      try { doc.image(logoBuf, M, y, { fit: [LOGO_FIT, LOGO_FIT] }); } catch {}
    }
    let ly = logoBuf ? y + LOGO_FIT + 4 : y + 2;

    doc.fillColor(BK).fontSize(8.5).font('Helvetica')
       .text('R.U.C.:   ' + ruc, M, ly, { width: leftW - 2 });
    ly += 12;
    doc.fontSize(9).font('Helvetica-Bold')
       .text(razonSocial, M, ly, { width: leftW - 2 });
    ly += 13;
    if (d.nombreComercial && d.nombreComercial !== razonSocial) {
      doc.fontSize(8).font('Helvetica')
         .text(d.nombreComercial, M, ly, { width: leftW - 2 });
      ly += 11;
    }
    if (dirMatriz) {
      doc.fontSize(8).font('Helvetica')
         .text('Dir. Matriz:  ' + dirMatriz, M, ly, { width: leftW - 2 });
      ly += 11;
    }
    if (d.dirEstab && d.dirEstab !== dirMatriz) {
      doc.fontSize(8).font('Helvetica')
         .text('Dir  ' + d.dirEstab, M, ly, { width: leftW - 2 });
      ly += 11;
    }
    ly += 5;
    if (cfg?.contribuyente_especial) {
      doc.fontSize(8).font('Helvetica')
         .text('Contribuyente Especial Resolución   ' + cfg.contribuyente_especial, M, ly, { width: leftW - 2 });
      ly += 11;
    }
    doc.fontSize(8).font('Helvetica')
       .text('OBLIGADO A LLEVAR CONTABILIDAD:   ' + (cfg?.obligado_contabilidad ? 'SI' : 'NO'), M, ly, { width: leftW - 2 });

    // ── Derecha: caja factura ────────────────────────────────────────────────
    let ry = y + 10;

    doc.fillColor(BK).fontSize(13).font('Helvetica-Bold')
       .text('F  A  C  T  U  R  A', rightX, ry, { width: rightW, align: 'center' });
    ry += 20;
    doc.fillColor(BLU).fontSize(11).font('Helvetica-Bold')
       .text('No.   ' + nroFactura, rightX, ry, { width: rightW, align: 'center' });
    ry += 16;
    doc.moveTo(rightX + 6, ry).lineTo(rightX + rightW - 6, ry).lineWidth(0.4).stroke(BDR);
    ry += 7;

    doc.fillColor(BK).fontSize(7.5).font('Helvetica')
       .text('NÚMERO DE AUTORIZACIÓN', rightX, ry, { width: rightW, align: 'center' });
    ry += 11;

    const authNum = inv.auth_number || claveAcceso || '';
    doc.fontSize(6).font('Courier')
       .text(authNum, rightX + 4, ry, { width: rightW - 8, align: 'center', charSpacing: 0.2 });
    ry += 11;

    const fmtDate = (d2) => d2
      ? new Date(d2).toLocaleString('es-EC', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        })
      : '-';
    const authDateStr = fmtDate(inv.auth_date || inv.emission_date);

    doc.fontSize(7).font('Helvetica').fillColor(BK)
       .text('FECHA Y HORA DE AUTORIZACIÓN   ' + authDateStr, rightX + 4, ry, { width: rightW - 8 });
    ry += 10;
    doc.text('AMBIENTE   ' + (esProduccion ? 'PRODUCCION' : 'PRUEBAS'), rightX + 4, ry, { width: rightW - 8 });
    ry += 10;
    doc.text('EMISIÓN:   NORMAL', rightX + 4, ry, { width: rightW - 8 });
    ry += 10;
    doc.fontSize(7.5).font('Helvetica')
       .text('CLAVE DE ACCESO', rightX, ry, { width: rightW, align: 'center' });
    ry += 8;

    if (barcodeBuf) {
      const bW = rightW - 10, bH = 28;
      try { doc.image(barcodeBuf, rightX + 5, ry, { width: bW, height: bH }); } catch {}
      ry += bH + 2;
    }
    doc.fontSize(5.8).font('Courier').fillColor(BK)
       .text(claveAcceso, rightX + 4, ry, { width: rightW - 8, align: 'center', charSpacing: 0.2 });

    y = M + hH + 4;

    // ══════════════════════════ CLIENTE ══════════════════════════════════════
    const razonComp = d.razonComprador || inv.customer_name || 'CONSUMIDOR FINAL';
    const idComp    = d.idComprador    || inv.customer_ruc  || '-';
    const fechaEmDisplay = d.fechaEmision
      || (inv.emission_date
          ? new Date(inv.emission_date).toLocaleDateString('es-EC',
              { day: '2-digit', month: '2-digit', year: 'numeric' })
          : '-');

    const cliH = 30;
    bord(M, y, W, cliH);

    const cW1 = W * 0.18, cW2 = W * 0.445, cW3 = W * 0.11, cW4 = W * 0.215;
    const cX1 = M + 4, cX2 = cX1 + cW1 + 2, cX3 = cX2 + cW2 + 2, cX4 = cX3 + cW3 + 2;

    doc.fontSize(7.5).font('Helvetica').fillColor(BK)
       .text('Razón Social / Nombres y', cX1, y + 4, { width: cW1 })
       .text('Fecha Emisión:', cX1, y + 17, { width: cW1 });
    doc.fontSize(8).font('Helvetica-Bold')
       .text(razonComp, cX2, y + 4, { width: cW2 })
       .text(fechaEmDisplay, cX2, y + 17, { width: cW2 });
    doc.fontSize(7.5).font('Helvetica')
       .text('RUC / CI:', cX3, y + 4, { width: cW3 })
       .text('Guía Remisión:', cX3, y + 17, { width: cW3 });
    doc.fontSize(8).font('Helvetica-Bold')
       .text(idComp, cX4, y + 4, { width: cW4 });

    y += cliH + 2;

    // ══════════════════════════ TABLA DE ÍTEMS ════════════════════════════════
    // Widths: 0.090+0.090+0.055+0.400+0.120+0.090+0.075+0.080 = 1.000
    const COLS = [
      { h: 'Cod. Principal',       w: 0.090, a: 'left'  },
      { h: 'Cod. Auxiliar',        w: 0.090, a: 'left'  },
      { h: 'Cant',                 w: 0.055, a: 'right' },
      { h: 'Descripción',          w: 0.400, a: 'left'  },
      { h: 'Detalles Adicionales', w: 0.120, a: 'left'  },
      { h: 'Precio\nUnitario',     w: 0.090, a: 'right' },
      { h: 'Descuento',            w: 0.075, a: 'right' },
      { h: 'Precio Total',         w: 0.080, a: 'right' },
    ];

    const thH = 20;
    fill(M, y, W, thH, LGR);
    bord(M, y, W, thH, 0.5);
    let cx = M;
    for (const col of COLS) {
      const cw = W * col.w;
      doc.fillColor(BK).fontSize(7).font('Helvetica-Bold')
         .text(col.h, cx + 2, y + 4, { width: cw - 4, align: 'center', lineGap: 0 });
      if (cx > M) doc.moveTo(cx, y).lineTo(cx, y + thH).lineWidth(0.3).stroke(BDR);
      cx += cw;
    }
    y += thH;

    let alt = false;
    for (const item of d.items) {
      const rH = 13;
      fill(M, y, W, rH, alt ? VLGR : WHT);
      bord(M, y, W, rH, 0.25);
      cx = M;
      const rv = [
        item.codigoPrincipal || '',
        item.codigoAuxiliar  || '',
        item.cantidad.toFixed(4),
        item.descripcion || '-',
        '',
        item.unitPrice.toFixed(4),
        item.descuento > 0 ? item.descuento.toFixed(2) : '0.00',
        item.lineTotal.toFixed(2),
      ];
      for (let i = 0; i < COLS.length; i++) {
        const cw = W * COLS[i].w;
        doc.fillColor(BK).fontSize(7).font('Helvetica')
           .text(rv[i], cx + 2, y + 3, { width: cw - 4, align: COLS[i].a, lineBreak: false });
        cx += cw;
      }
      y += rH;
      alt = !alt;
      if (y > doc.page.height - 180) { doc.addPage(); y = M; }
    }
    if (d.items.length === 0) {
      fill(M, y, W, 14, WHT);
      doc.fillColor(GR).fontSize(7).text('(sin ítems registrados)', M + 6, y + 3);
      y += 14;
    }
    y += 4;

    // ══════════════════════════ INFO ADICIONAL + TOTALES ══════════════════════
    const infoW = W * 0.55;
    const totW  = W - infoW - 4;
    const totX  = M + infoW + 4;

    const totRows = [];
    for (const rate of ivaRates) {
      totRows.push(['SUBTOTAL ' + rate + '%', (subtotalByRate[rate] || 0).toFixed(2)]);
    }
    if (!subtotalByRate[0]) totRows.push(['SUBTOTAL 0%', '0.00']);
    totRows.push(['SUBTOTAL Exento de IVA',   '0.00']);
    totRows.push(['SUBTOTAL SIN IMPUESTOS',   subtotal.toFixed(2)]);
    totRows.push(['TOTAL DESCUENTO',          '0.00']);
    totRows.push(['ICE',                      '0.00']);
    totRows.push(['IVA ' + mainRate + '%',    iva.toFixed(2)]);
    totRows.push(['PROPINA',                  '0.00']);

    const totRowH = 13;

    // Info Adicional
    let iy = y;
    doc.fillColor(BK).fontSize(7.5).font('Helvetica-Bold')
       .text('Información Adicional', M, iy);
    iy += 13;
    const emailVal = inv.customer_email || '';
    if (emailVal) {
      doc.fontSize(7).font('Helvetica')
         .text('Correo 1   ' + emailVal, M, iy, { width: infoW - 4 });
      iy += 11;
    }
    if (cfg?.contribuyente_especial) {
      doc.fontSize(7).font('Helvetica')
         .text('Gran Contribuyente   Gran Contribuyente Resolucion No ' + cfg.contribuyente_especial, M, iy, { width: infoW - 4 });
      iy += 11;
    }

    // Totales
    let ty = y;
    for (const [label, val] of totRows) {
      fill(totX, ty, totW, totRowH, ty % 26 < 13 ? VLGR : WHT);
      bord(totX, ty, totW, totRowH, 0.3);
      doc.fillColor(BK).fontSize(7).font('Helvetica')
         .text(label, totX + 4, ty + 3, { width: totW * 0.65 })
         .text(val, totX + 4, ty + 3, { width: totW - 8, align: 'right' });
      ty += totRowH;
    }
    fill(totX, ty, totW, 15, BK);
    doc.fillColor(WHT).fontSize(8).font('Helvetica-Bold')
       .text('VALOR TOTAL', totX + 4, ty + 3, { width: totW * 0.65 })
       .text(total.toFixed(2), totX + 4, ty + 3, { width: totW - 8, align: 'right' });
    ty += 15;

    y = Math.max(iy, ty) + 6;

    // ══════════════════════════ FORMA DE PAGO ════════════════════════════════
    fill(M, y, W, 14, LGR);
    bord(M, y, W, 14);
    doc.fillColor(BK).fontSize(7).font('Helvetica-Bold')
       .text('Forma de Pago', M + 6, y + 4, { width: W * 0.55 })
       .text('Valor',  M + W * 0.57, y + 4, { width: W * 0.14, align: 'right' })
       .text('Plazo',  M + W * 0.73, y + 4, { width: W * 0.12, align: 'right' })
       .text('Tiempo', M + W * 0.87, y + 4, { width: W * 0.11, align: 'right' });
    y += 14;

    fill(M, y, W, 14, WHT);
    bord(M, y, W, 14, 0.3);
    doc.fillColor(BK).fontSize(7.5).font('Helvetica')
       .text(formaPagoLabel, M + 6, y + 3, { width: W * 0.55 })
       .text(total.toFixed(2), M + W * 0.57, y + 3, { width: W * 0.14, align: 'right' })
       .text('0',              M + W * 0.73, y + 3, { width: W * 0.12, align: 'right' })
       .text('Dias',           M + W * 0.87, y + 3, { width: W * 0.11, align: 'right' });
    y += 14 + 8;

    // ══════════════════════════ FOOTER ════════════════════════════════════════
    doc.fillColor(GR).fontSize(7).font('Helvetica')
       .text('Página 1 de 1', M, y, { width: W, align: 'center' });

    doc.end();
  });
}
