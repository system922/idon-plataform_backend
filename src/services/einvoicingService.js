/**
 * einvoicingService.js
 * Servicio central para emisión y gestión de facturas electrónicas SRI.
 * Usa osodreamer-sri-xml-signer.
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
import { sendInvoiceEmail } from './emailService.js';

cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads/signatures');

// ------------------- Helpers --------------------
function pad(n, len) {
  return String(n).padStart(len, '0');
}

function ivaCode(rate) {
  const rateNum = Number(rate);
  // Mapeo de códigos SRI para cada tasa
  if (rateNum === 0) return 0;   // IVA 0%
  if (rateNum === 5) return 5;   // IVA 5%
  if (rateNum === 8) return 6;   // IVA 8%
  if (rateNum === 12) return 2;  // IVA 12%
  if (rateNum === 15) return 4;  // IVA 15%
  return 4; // default 15%
}

function normalizeObligadoContabilidad(value) {
  if (value === true || value === 'SI' || value === 'si' || value === 'S') return 'SI';
  if (value === false || value === 'NO' || value === 'no' || value === 'N') return 'NO';
  return 'NO';
}

function normalizeSriError(err) {
  if (!err) return { status: 'pendiente', message: 'Error desconocido en autorización SRI' };

  const estado = err.estado || err.name || '';
  const message = err.messageSRI || err.mensajeSRI || err.message || 'Error en la autorización SRI';

  if (['NO AUTORIZADO', 'RECHAZADA', 'DEVUELTA', 'ERROR'].includes(estado)) {
    return { status: 'rechazada', message };
  }

  return { status: 'pendiente', message };
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
  const p12Base64 = buffer.toString('base64');

  try {
    await query(`ALTER TABLE "${schema}".einvoice_config ADD COLUMN IF NOT EXISTS p12_base64 TEXT`);
  } catch { }

  try {
    await query(
      `UPDATE "${schema}".einvoice_config SET p12_base64 = $1, updated_at = NOW()`,
      [p12Base64]
    );
  } catch (e) {
    logger.warn({ err: e.message }, 'Could not save p12_base64 to DB');
  }

  try {
    const dir = path.join(UPLOADS_DIR, schema);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'firma.p12');
    await writeFile(filePath, buffer);
    return filePath;
  } catch {
    return null;
  }
}

// ------------------- CORE: Emisión (CON SUBTOTALES POR TASA Y DESCUENTOS) -------------------
export async function emitInvoice(schema, opts) {
  const cfg = await getConfig(schema);
  if (!cfg) throw new Error('Configuración de facturación electrónica no encontrada');
  if (!cfg.p12_base64 && !cfg.p12_path) throw new Error('No hay firma electrónica cargada');
  if (!cfg.ruc) throw new Error('RUC del emisor no configurado');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: seqRows } = await client.query(
      `UPDATE "${schema}".einvoice_config
         SET secuencial_actual = secuencial_actual + 1
       RETURNING secuencial_actual - 1 AS seq`
    );
    const secuencial = seqRows[0].seq;

    const now = new Date();
    const estab = cfg.serie_estab || '001';
    const ptoEmi = cfg.serie_pto_emision || '001';
    const ambiente = cfg.ambiente || '1';
    const envEnum = parseInt(ambiente, 10);
    const envStr = envEnum === 2 ? 'prod' : 'test';

    const invoiceNumber = `${estab}-${ptoEmi}-${pad(secuencial, 9)}`;
    const customer = opts.customer || {};
    const tipoId = customer.tipo_identificacion || '07';
    const idComprador = customer.ruc || '9999999999';
    const razonComprador = customer.name || 'CONSUMIDOR FINAL';
    
    // 🔥 OBTENER VALORES DEL FRONTEND
    const totalDescuento = parseFloat(opts.descuento || 0);
    const ivaAmountTotal = parseFloat(opts.iva_amount || 0);
    const totalFactura = parseFloat(opts.total || 0);
    const items = opts.items || [];

    console.log('💰💰💰 VALORES RECIBIDOS DEL FRONTEND:', {
      totalDescuento,
      ivaAmountTotal,
      totalFactura,
      itemsCount: items.length
    });

    // 🔥 PROCESAR ITEMS Y CALCULAR SUBTOTALES POR TASA
    const subtotalByRate = {
      0: 0,
      5: 0,
      8: 0,
      12: 0,
      15: 0,
    };
    
    const ivaByRate = {
      0: 0,
      5: 0,
      8: 0,
      12: 0,
      15: 0,
    };

    const codigoPorcentajeMap = {
      0: 0,
      5: 5,
      8: 6,
      12: 2,
      15: 4,
    };

    const detalleItems = items.map((item) => {
      const qty = parseFloat(item.qty || item.quantity || 1);
      const unitPrice = parseFloat(item.unit_price || 0);
      const subtotalItem = parseFloat(item.subtotal || (qty * unitPrice));
      const ivaItem = parseFloat(item.iva_amount || 0);
      
      let tasaIVA = parseFloat(item.iva_rate_pct || item.is_taxable || 0);
      
      if (tasaIVA === 0 && ivaItem > 0 && subtotalItem > 0) {
        const inferredRate = Math.round((ivaItem / subtotalItem) * 100);
        if ([0, 5, 8, 12, 15].includes(inferredRate)) {
          tasaIVA = inferredRate;
        } else if (ivaItem > 0) {
          tasaIVA = 15;
        }
      }
      
      if (ivaItem === 0 && tasaIVA !== 0) {
        tasaIVA = 0;
      }

      let descuentoItem = 0;
      const totalGlobal = subtotalItem + (ivaItem || 0);
      if (totalDescuento > 0 && totalFactura > 0 && totalGlobal > 0) {
        const ratio = totalGlobal / totalFactura;
        descuentoItem = Math.round((totalDescuento * ratio) * 100) / 100;
      }

      const precioBase = Math.max(0, subtotalItem - descuentoItem);
      const ivaCalculado = tasaIVA > 0 && ivaItem === 0
        ? Math.round((precioBase * tasaIVA / 100) * 100) / 100
        : ivaItem;

      if (subtotalByRate[tasaIVA] !== undefined) {
        subtotalByRate[tasaIVA] += precioBase;
        ivaByRate[tasaIVA] += ivaCalculado;
      } else {
        subtotalByRate[15] += precioBase;
        ivaByRate[15] += ivaCalculado;
        tasaIVA = 15;
      }

      console.log(`📦 ${item.description}: tasa=${tasaIVA}%, base=${precioBase.toFixed(2)}, iva=${ivaCalculado.toFixed(2)}`);

      return {
        codigoPrincipal: item.code || item.codigo || 'PROD',
        codigoAuxiliar: item.aux_code || '',
        descripcion: item.description || item.name || 'Producto',
        cantidad: qty,
        precioUnitario: unitPrice,
        descuento: descuentoItem,
        precioTotalSinImpuesto: precioBase,
        impuestos: {
          impuesto: [{
            codigo: 2,
            codigoPorcentaje: ivaCode(tasaIVA),
            tarifa: tasaIVA,
            baseImponible: precioBase,
            valor: ivaCalculado,
          }],
        },
      };
    });

    const subtotalSinIVA = subtotalByRate[0] || 0;
    const subtotalConIVA = Object.entries(subtotalByRate)
      .filter(([rate]) => Number(rate) > 0)
      .reduce((sum, [_, val]) => sum + val, 0);
    const subtotalTotal = subtotalSinIVA + subtotalConIVA;
    
    const ivaTotal = Object.values(ivaByRate).reduce((sum, val) => sum + val, 0);

    console.log('📊 SUBTOTALES POR TASA:', {
      'IVA 0%': subtotalByRate[0].toFixed(2),
      'IVA 5%': subtotalByRate[5].toFixed(2),
      'IVA 8%': subtotalByRate[8].toFixed(2),
      'IVA 12%': subtotalByRate[12].toFixed(2),
      'IVA 15%': subtotalByRate[15].toFixed(2),
      'SUBTOTAL TOTAL': subtotalTotal.toFixed(2),
      'IVA TOTAL': ivaTotal.toFixed(2),
      'TOTAL FACTURA': (subtotalTotal + ivaTotal - totalDescuento).toFixed(2)
    });

    const totalImpuestoArray = [];
    
    const tasasConValor = Object.keys(subtotalByRate)
      .filter(rate => subtotalByRate[rate] > 0)
      .map(Number)
      .sort((a, b) => b - a);

    tasasConValor.forEach(rate => {
      const subtotal = subtotalByRate[rate];
      const iva = ivaByRate[rate];
      
      if (subtotal > 0 || iva > 0) {
        totalImpuestoArray.push({
          codigo: 2,
          codigoPorcentaje: codigoPorcentajeMap[rate] || 4,
          baseImponible: Math.round(subtotal * 100) / 100,
          valor: Math.round(iva * 100) / 100,
        });
      }
    });

    if (totalImpuestoArray.length === 0) {
      totalImpuestoArray.push({
        codigo: 2,
        codigoPorcentaje: 0,
        baseImponible: subtotalTotal,
        valor: 0,
      });
    }

    console.log('📊 TOTAL IMPUESTOS ARRAY:', totalImpuestoArray);

    // 🔥 CONSTRUIR EL COMPROBANTE - CORREGIDO
    const comprobante = {
      infoTributaria: {
        ruc: cfg.ruc,
        ambiente: envEnum,
        dirMatriz: cfg.direccion_matriz || 'Ecuador',
        estab,
        ptoEmi,
        secuencial: pad(secuencial, 9),
        razonSocial: cfg.razon_social,
        ...(cfg.nombre_comercial ? { nombreComercial: cfg.nombre_comercial } : {}),
        ...(cfg.agente_retencion ? { agenteRetencion: String(cfg.agente_retencion) } : {}),
        ...(cfg.contribuyente_rimpe ? { contribuyenteRimpe: cfg.contribuyente_rimpe } : {}),
      },
      infoFactura: {
        fechaEmision: now,
        dirEstablecimiento: cfg.direccion_establecimiento || cfg.direccion_matriz || 'Ecuador',
        ...(cfg.contribuyente_especial ? { contribuyenteEspecial: cfg.contribuyente_especial } : {}),
        obligadoContabilidad: normalizeObligadoContabilidad(cfg.obligado_contabilidad),
        tipoIdentificacionComprador: tipoId,
        razonSocialComprador: razonComprador,
        identificacionComprador: idComprador,
        
        totalSinImpuestos: Math.round(subtotalTotal * 100) / 100,
        totalDescuento: Math.round(totalDescuento * 100) / 100,
        propina: 0,
        importeTotal: Math.round((subtotalTotal + ivaTotal - totalDescuento) * 100) / 100,
        moneda: 'USD',
        
        totalConImpuestos: {
          totalImpuesto: totalImpuestoArray,
        },
        pagos: {
          pago: [{
            formaPago: opts.forma_pago || '01',
            total: Math.round((subtotalTotal + ivaTotal - totalDescuento) * 100) / 100,
            ...(opts.plazo ? { plazo: Number(opts.plazo) } : {}),
            ...(opts.unidad_tiempo ? { unidadTiempo: opts.unidad_tiempo } : {}),
          }],
        },
      },
      detalles: {
        detalle: detalleItems,
      },
    };

    // Generar XML
    const { generatedXml } = await generateXmlInvoice(comprobante);
    const claveMatch = generatedXml.match(/<claveAcceso>([^<]+)<\/claveAcceso>/);
    const claveAcceso = claveMatch?.[1] || '';

    let p12Buffer;
    if (cfg.p12_base64) {
      p12Buffer = Buffer.from(cfg.p12_base64, 'base64');
    } else if (cfg.p12_path) {
      p12Buffer = await readFile(cfg.p12_path);
    } else {
      throw new Error('No hay firma electrónica cargada');
    }
    
    const signedXml = await signXml({
      p12Buffer: new Uint8Array(p12Buffer),
      password: cfg.p12_password || '',
      xmlBuffer: new TextEncoder().encode(generatedXml),
    });

    const phone = customer.phone || opts.customer_phone || null;

    try {
      await client.query(`ALTER TABLE "${schema}".einvoices ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0`);
    } catch { }
    
    console.log('💾 GUARDANDO EN DB:', {
      subtotal: subtotalTotal.toFixed(2),
      iva_amount: ivaTotal.toFixed(2),
      total: (subtotalTotal + ivaTotal - totalDescuento).toFixed(2),
      totalDescuento: totalDescuento.toFixed(2)
    });

    const { rows } = await client.query(
      `INSERT INTO "${schema}".einvoices
         (order_id, invoice_number, access_key, auth_number,
          customer_id, customer_name, customer_ruc, customer_email, customer_phone,
          subtotal, iva_amount, total, items, discount_amount,
          signed_xml, status, sri_message, sri_json, emission_date, auth_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        opts.order_id || null, invoiceNumber, claveAcceso, null,
        customer.id || null, razonComprador, idComprador, customer.email || null, phone,
        subtotalTotal.toFixed(2),
        ivaTotal.toFixed(2),
        (subtotalTotal + ivaTotal - totalDescuento).toFixed(2),
        JSON.stringify(opts.items || []),
        totalDescuento.toFixed(2),
        signedXml,
        'pendiente', null, null,
        now, null,
      ]
    );

    await client.query('COMMIT');
    const savedInvoice = rows[0];

    // 🔥🔥🔥 ESPERAR LA AUTORIZACIÓN SRI (SÍNCRONO) 🔥🔥🔥
    console.log('⏳ Esperando autorización SRI...');
    try {
      await _authorizeSriBackground(schema, savedInvoice, signedXml, claveAcceso, envStr);
      console.log('✅ Autorización SRI completada');
    } catch (err) {
      console.error('❌ Error en autorización SRI:', err);
      // No lanzar el error para no romper el flujo
      // La factura ya está guardada como 'pendiente'
    }

    // 🔥 RECARGAR LA FACTURA PARA OBTENER EL ESTADO ACTUALIZADO
    const { rows: updatedRows } = await client.query(
      `SELECT * FROM "${schema}".einvoices WHERE id = $1`,
      [savedInvoice.id]
    );
    const updatedInvoice = updatedRows[0] || savedInvoice;

    console.log('📊 FACTURA FINAL:', {
      id: updatedInvoice.id,
      invoice_number: updatedInvoice.invoice_number,
      status: updatedInvoice.status,
      auth_number: updatedInvoice.auth_number
    });

    return updatedInvoice;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en emitInvoice:', err);
    throw err;
  } finally {
    client.release();
  }
}

// ── Autorización SRI en background ────────────────────
async function _authorizeSriBackground(schema, invoice, signedXml, claveAcceso, envStr) {
  let status = 'pendiente', authNumber = null, authDate = null, sriMessage = null;
  let sriJsonString = null;
  
  console.log('========================================');
  console.log('📤 INICIANDO AUTORIZACIÓN SRI');
  console.log('Schema:', schema);
  console.log('Invoice ID:', invoice.id);
  console.log('Invoice Number:', invoice.invoice_number);
  console.log('Clave Acceso:', claveAcceso);
  console.log('Env:', envStr);
  console.log('========================================');
  
  try {
    console.log('📤 PASO 1: Validando XML en SRI...');
    const recResult = await validateXml({
      xml: new TextEncoder().encode(signedXml),
      env: envStr,
    });
    console.log('📥 RESPUESTA RECEPCIÓN:', JSON.stringify(recResult, null, 2));
    logger.info({ recResult }, 'SRI recepción (bg)');

    if (recResult?.estado === 'RECIBIDA') {
      console.log('✅ XML RECIBIDO, PASO 2: Autorizando...');
      
      // Esperar un momento antes de autorizar
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('📤 Enviando a autorización con clave:', claveAcceso);
      const authResult = await authorizeXml({ 
        claveAcceso, 
        env: envStr,
        timeout: 30000
      });
      
      console.log('📥 RESPUESTA AUTORIZACIÓN COMPLETA:');
      console.log(JSON.stringify(authResult, null, 2));
      logger.info({ authResult }, 'SRI autorización (bg)');
      
      // 🔥 GUARDAR LA RESPUESTA COMPLETA (pero sanitizada)
      if (authResult) {
        // Primero, guardar todo el objeto para debug
        const authResultSanitizado = { ...authResult };
        
        // Eliminar campos con XML gigante (pero guardarlos en otro lado si es necesario)
        if (authResultSanitizado.comprobante) {
          // Guardar el XML en un campo separado si quieres
          // O simplemente eliminarlo
          delete authResultSanitizado.comprobante;
        }
        if (authResultSanitizado.comprobanteCrudo) {
          delete authResultSanitizado.comprobanteCrudo;
        }
        
        // Si hay mensajes, asegurar que sean strings
        if (authResultSanitizado.mensajes && Array.isArray(authResultSanitizado.mensajes)) {
          authResultSanitizado.mensajes = authResultSanitizado.mensajes.map(m => 
            typeof m === 'string' ? m : (m.mensaje || m.message || String(m))
          );
        }
        
        sriJsonString = JSON.stringify(authResultSanitizado);
        console.log('📊 SRI JSON SANITIZADO (tamaño):', sriJsonString.length, 'caracteres');
        console.log('📊 SRI JSON CONTENIDO:', sriJsonString.substring(0, 500) + '...');
      }

      if (authResult?.estadoAutorizacion === 'AUTORIZADO') {
        status = 'autorizada';
        authNumber = authResult.numeroAutorizacion || authResult.claveAcceso || claveAcceso;
        authDate = authResult.fechaAutorizacion ? new Date(authResult.fechaAutorizacion) : new Date();
        console.log('✅ ✅ ✅ FACTURA AUTORIZADA ✅ ✅ ✅');
        console.log('Número de autorización:', authNumber);
        console.log('Fecha de autorización:', authDate);
      } else {
        status = 'rechazada';
        sriMessage = (authResult?.mensajes || []).map(m => 
          typeof m === 'string' ? m : (m.mensaje || m.message || String(m))
        ).join(' | ') || authResult?.estadoAutorizacion || 'Rechazada por el SRI';
        console.log('❌ FACTURA RECHAZADA:', sriMessage);
      }
    } else {
      status = 'rechazada';
      sriMessage = recResult?.mensaje || 'No recibida por el SRI';
      console.log('❌ NO RECIBIDA POR SRI:', sriMessage);
      console.log('Respuesta recepción:', JSON.stringify(recResult, null, 2));
    }
  } catch (sriErr) {
    console.error('❌ ❌ ❌ ERROR EN AUTORIZACIÓN SRI ❌ ❌ ❌');
    console.error('Error:', sriErr);
    console.error('Stack:', sriErr.stack);
    logger.error({ err: sriErr.message, stack: sriErr.stack }, 'SRI background error');

    const normalized = normalizeSriError(sriErr);
    status = normalized.status;
    sriMessage = normalized.message;
  }

  console.log('========================================');
  console.log('💾 ACTUALIZANDO FACTURA EN DB');
  console.log('ID:', invoice.id);
  console.log('Status:', status);
  console.log('Auth Number:', authNumber);
  console.log('sriJsonString length:', sriJsonString ? sriJsonString.length : 0);
  console.log('========================================');

  try {
    const { rows: updated } = await query(
      `UPDATE "${schema}".einvoices
          SET status = $1, auth_number = $2, auth_date = $3,
              sri_message = $4, sri_json = $5, updated_at = NOW()
        WHERE id = $6
        RETURNING *`,
      [status, authNumber, authDate, sriMessage, sriJsonString, invoice.id]
    );

    const updatedInvoice = updated[0];
    if (!updatedInvoice) {
      console.error('⚠️ No se pudo actualizar factura en DB - no rows returned');
      return;
    }

    console.log('✅ FACTURA ACTUALIZADA EN DB:');
    console.log('  ID:', updatedInvoice.id);
    console.log('  Status:', updatedInvoice.status);
    console.log('  Auth Number:', updatedInvoice.auth_number);
    console.log('  sri_json exists:', !!updatedInvoice.sri_json);
    console.log('========================================');

    // ✅ Enviar email si está autorizada
    if (status === 'autorizada' && updatedInvoice.customer_email) {
      try {
        console.log('📧 Enviando email a:', updatedInvoice.customer_email);
        const cfg = await getConfig(schema);
        const bizName = cfg?.nombre_comercial || cfg?.razon_social || 'Empresa';
        const pdfBuf = await generateInvoicePdf(schema, updatedInvoice.id);
        await sendInvoiceEmail(updatedInvoice, pdfBuf, updatedInvoice.customer_email, bizName);
        console.log('✅ Email enviado');
      } catch (e) {
        console.error('❌ Error enviando email:', e.message);
        logger.warn({ err: e.message }, 'Email send failed (non-blocking)');
      }
    }
  } catch (dbErr) {
    console.error('❌ ❌ ❌ ERROR ACTUALIZANDO DB ❌ ❌ ❌');
    console.error('Error:', dbErr);
    console.error('Stack:', dbErr.stack);
    logger.error({ err: dbErr.message, stack: dbErr.stack }, 'DB update error');
  }
}

// ------------------- RESEND -------------------
export async function resendInvoice(schema, invoiceId) {
  const cfg = await getConfig(schema);
  if (!cfg?.p12_base64 && !cfg?.p12_path) throw new Error('No hay firma electrónica cargada');

  const { rows } = await query(
    `SELECT * FROM "${schema}".einvoices WHERE id = $1`, [invoiceId]
  );
  const inv = rows[0];
  if (!inv) throw new Error('Factura no encontrada');
  if (!inv.signed_xml) throw new Error('XML firmado no disponible');

  const ambiente = cfg.ambiente || '1';
  const envStr = parseInt(ambiente, 10) === 2 ? 'prod' : 'test';
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
      status = 'autorizada';
      authNumber = authResult.claveAcceso || inv.access_key;
      authDate = authResult.fechaAutorizacion ? new Date(authResult.fechaAutorizacion) : new Date();
      sriMessage = null;
    } else {
      status = 'rechazada';
      authNumber = null;
      authDate = null;
      sriMessage = (authResult?.mensajes || []).map(m => m.mensaje).join(' | ')
                 || authResult?.estadoAutorizacion || 'Rechazada por el SRI';
    }
  } catch (sriErr) {
    status = 'error';
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
  await query(`ALTER TABLE IF EXISTS "${schema}".einvoices ADD COLUMN IF NOT EXISTS credited_amount NUMERIC(10,2) DEFAULT 0`);
  const where = status ? `WHERE status = $1` : '';
  const params = status ? [status] : [];
  const { rows } = await query(
    `SELECT id, invoice_number, access_key, auth_number,
            customer_id, customer_name, customer_ruc, customer_email, customer_phone,
            subtotal, iva_amount, total, discount_amount, items,
            COALESCE(credited_amount, 0) AS credited_amount,
            status, sri_message, sri_json,
            emission_date, auth_date, created_at,
            (signed_xml IS NOT NULL AND signed_xml <> '') AS has_signed_xml
       FROM "${schema}".einvoices
       ${where}
       ORDER BY created_at DESC
       LIMIT ${parseInt(limit, 10)}`,
    params
  );
  return rows;
}

// ------------------- PARSEO XML -------------------
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

  const it = factura?.infoTributaria ?? {};
  const inf = factura?.infoFactura ?? {};

  let rawDetalles = factura?.detalles?.detalle ?? [];
  if (!Array.isArray(rawDetalles)) rawDetalles = [rawDetalles];

  // Mapeo de códigos de porcentaje SRI a tasas
  const codigoPorcentajeMap = {
    '0': 0,   // IVA 0%
    '2': 12,  // IVA 12%
    '4': 15,  // IVA 15%
    '5': 5,   // IVA 5%
    '6': 8,   // IVA 8%
    '7': 0,   // No objeto de IVA
  };

  const items = rawDetalles.map(d => {
    let rawImp = d?.impuestos?.impuesto ?? [];
    if (!Array.isArray(rawImp)) rawImp = [rawImp];
    
    // Buscar el impuesto con código 2 (IVA)
    const ivaImp = rawImp.find(i => str(i?.codigo) === '2') || rawImp[0] || {};
    
    let tarifa = 0;
    
    // 1. Intentar obtener la tarifa directamente
    const tarifaRaw = num(ivaImp?.tarifa);
    if (tarifaRaw > 0) {
      if (tarifaRaw <= 1) {
        tarifa = Math.round(tarifaRaw * 100);
      } else if (tarifaRaw <= 100) {
        tarifa = Math.round(tarifaRaw);
      } else {
        tarifa = 15;
      }
    }
    
    // 2. Si no hay tarifa, usar el códigoPorcentaje
    if (tarifa === 0) {
      const codigoPorcentaje = str(ivaImp?.codigoPorcentaje);
      tarifa = codigoPorcentajeMap[codigoPorcentaje] ?? 0;
    }
    
    // 3. Si sigue siendo 0, verificar si el item tiene IVA
    const valorIVA = num(ivaImp?.valor);
    if (tarifa === 0 && valorIVA > 0) {
      // Inferir tarifa del valor del IVA y la base imponible
      const baseImponible = num(d?.precioTotalSinImpuesto);
      if (baseImponible > 0) {
        const tarifaInferida = Math.round((valorIVA / baseImponible) * 100);
        if ([0, 5, 8, 12, 15].includes(tarifaInferida)) {
          tarifa = tarifaInferida;
        }
      }
    }
    
    console.log(`📊 Ítem: ${str(d?.codigoPrincipal)} - Tarifa IVA: ${tarifa}%, Valor IVA: ${valorIVA}`);
    
    return {
      codigoPrincipal: str(d?.codigoPrincipal),
      codigoAuxiliar: str(d?.codigoAuxiliar),
      descripcion: str(d?.descripcion),
      cantidad: num(d?.cantidad),
      unitPrice: num(d?.precioUnitario),
      descuento: num(d?.descuento),
      lineTotal: num(d?.precioTotalSinImpuesto),
      ivaRate: tarifa,
      ivaValue: valorIVA,
    };
  });

  // Calcular subtotales por tasa
  const subtotalByRate = {};
  const ivaByRate = {};
  for (const item of items) {
    const rate = item.ivaRate;
    subtotalByRate[rate] = (subtotalByRate[rate] || 0) + item.lineTotal;
    ivaByRate[rate] = (ivaByRate[rate] || 0) + item.ivaValue;
  }
  
  // Obtener totales del XML o calcular desde items
  const totalSinImpuestos = num(inf?.totalSinImpuestos);
  const totalDescuento = num(inf?.totalDescuento || 0);
  
  // Calcular IVA total desde los items
  const ivaTotal = items.reduce((sum, item) => sum + item.ivaValue, 0);
  
  const importeTotal = num(inf?.importeTotal);

  console.log('💰 Totales parseados:', {
    subtotalByRate,
    ivaByRate,
    totalSinImpuestos,
    totalDescuento,
    ivaTotal,
    importeTotal,
    itemsCount: items.length
  });

  return {
    razonSocial: str(it?.razonSocial),
    ruc: str(it?.ruc),
    nombreComercial: str(it?.nombreComercial),
    dirMatriz: str(it?.dirMatriz),
    dirEstab: str(inf?.dirEstablecimiento),
    claveAcceso: str(it?.claveAcceso),
    ambiente: str(it?.ambiente),
    estab: str(it?.estab),
    ptoEmi: str(it?.ptoEmi),
    secuencial: str(it?.secuencial),
    fechaEmision: str(inf?.fechaEmision),
    tipoIdComprador: str(inf?.tipoIdentificacionComprador),
    razonComprador: str(inf?.razonSocialComprador),
    idComprador: str(inf?.identificacionComprador),
    subtotal: totalSinImpuestos + Object.values(subtotalByRate).reduce((a, b) => a + b, 0),
    totalDescuento: totalDescuento,
    iva: ivaTotal,
    total: importeTotal,
    formaPago: str(inf?.pagos?.pago?.formaPago ?? inf?.pagos?.pago?.[0]?.formaPago),
    items,
    subtotalByRate,
    ivaByRate,
    subtotal0: subtotalByRate[0] || 0,
    subtotal15: subtotalByRate[15] || 0,
  };
}

async function generateBarcode(text) {
  try {
    const bwipjs = await import('bwip-js');
    const fn = bwipjs.default?.toBuffer || bwipjs.toBuffer;
    return await fn({ bcid: 'code128', text, scale: 2, height: 10, includetext: false, backgroundcolor: 'ffffff' });
  } catch { return null; }
}

// ------------------- GENERACIÓN PDF (CON SUBTOTALES POR TASA) -------------------
export async function generateInvoicePdf(schema, invoiceId) {
  const { rows: invRows } = await query(
    `SELECT * FROM "${schema}".einvoices WHERE id = $1`, [invoiceId]
  );
  const inv = invRows[0];
  if (!inv) throw new Error('Factura no encontrada');
  if (!inv.signed_xml) throw new Error('XML firmado no disponible');

  const d = await parseFacturaFromXml(inv.signed_xml);
  const cfg = await getConfig(schema);

  let logoBuf = null;
  if (cfg?.logo_url) {
    try {
      const res = await fetch(cfg.logo_url);
      if (res.ok) logoBuf = Buffer.from(await res.arrayBuffer());
    } catch { }
  }

  const razonSocial = d.razonSocial || cfg?.razon_social || 'EMISOR';
  const ruc = d.ruc || cfg?.ruc || '-';
  const dirMatriz = d.dirMatriz || cfg?.direccion_matriz || '';
  const nroFactura = inv.invoice_number || `${d.estab}-${d.ptoEmi}-${d.secuencial}`;
  const esProduccion = d.ambiente === '2';

  const totalDescuento = d.totalDescuento || parseFloat(inv.discount_amount || 0);
  const total = d.total || parseFloat(inv.total || 0);

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
  const barcodeBuf = await generateBarcode(claveAcceso);

  // Calcular subtotales por tasa correctamente
  const subtotalByRate = {};
  const ivaByRate = {};
  for (const item of d.items) {
    const rate = item.ivaRate;
    subtotalByRate[rate] = (subtotalByRate[rate] || 0) + item.lineTotal;
    ivaByRate[rate] = (ivaByRate[rate] || 0) + item.ivaValue;
  }
  
  const ivaRates = Object.keys(subtotalByRate).map(Number).sort((a, b) => b - a);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M = 30;
    const PW = doc.page.width;
    const W = PW - M * 2;
    const BK = '#000000';
    const GR = '#666666';
    const LGR = '#eeeeee';
    const VLGR = '#f9f9f9';
    const WHT = '#ffffff';
    const BLU = '#1a56db';
    const BDR = '#999999';

    const bord = (x, y2, w, h, lw = 0.5) => doc.rect(x, y2, w, h).lineWidth(lw).stroke(BDR);
    const fill = (x, y2, w, h, color) => doc.rect(x, y2, w, h).fill(color);

    let y = M;

    // ==================== HEADER CON RECUADRO ====================
    const leftW = Math.round(W * 0.52);
    const rightW = W - leftW - 4;
    const rightX = M + leftW + 4;
    const hH = 178;

    bord(rightX, y, rightW, hH, 0.8);

    const LOGO_FIT = 100;
    if (logoBuf) {
      try { doc.image(logoBuf, M, y, { fit: [LOGO_FIT, LOGO_FIT] }); } catch { }
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
         .text('Dir. Establecimiento:  ' + d.dirEstab, M, ly, { width: leftW - 2 });
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
      try { doc.image(barcodeBuf, rightX + 5, ry, { width: bW, height: bH }); } catch { }
      ry += bH + 2;
    }
    doc.fontSize(5.8).font('Courier').fillColor(BK)
       .text(claveAcceso, rightX + 4, ry, { width: rightW - 8, align: 'center', charSpacing: 0.2 });

    y = M + hH + 4;

    // ==================== CLIENTE ====================
    const razonComp = d.razonComprador || inv.customer_name || 'CONSUMIDOR FINAL';
    const idComp = d.idComprador || inv.customer_ruc || '-';
    const fechaEmDisplay = d.fechaEmision
      || (inv.emission_date
          ? new Date(inv.emission_date).toLocaleDateString('es-EC',
              { day: '2-digit', month: '2-digit', year: 'numeric' })
          : '-');
    const customerEmail = inv.customer_email || '';

    const cliH = 35;
    bord(M, y, W, cliH);

    const cW1 = W * 0.18, cW2 = W * 0.32, cW3 = W * 0.18, cW4 = W * 0.27;
    const cX1 = M + 4, cX2 = cX1 + cW1 + 2, cX3 = cX2 + cW2 + 2, cX4 = cX3 + cW3 + 2;

    doc.fontSize(7.5).font('Helvetica').fillColor(BK)
       .text('Razón Social / Nombres', cX1, y + 4, { width: cW1 });
    doc.fontSize(8).font('Helvetica-Bold')
       .text(razonComp, cX2, y + 4, { width: cW2 });
    
    doc.fontSize(7.5).font('Helvetica')
       .text('RUC / CI:', cX3, y + 4, { width: cW3 });
    doc.fontSize(8).font('Helvetica-Bold')
       .text(idComp, cX4, y + 4, { width: cW4 });

    doc.fontSize(7.5).font('Helvetica')
       .text('Fecha Emisión:', cX1, y + 20, { width: cW1 });
    doc.fontSize(8).font('Helvetica-Bold')
       .text(fechaEmDisplay, cX2, y + 20, { width: cW2 });

    if (customerEmail) {
      doc.fontSize(7.5).font('Helvetica')
         .text('Correo Electrónico:', cX3, y + 20, { width: cW3 });
      doc.fontSize(8).font('Helvetica')
         .text(customerEmail, cX4, y + 20, { width: cW4 });
    }

    y += cliH + 2;

    // ==================== TABLA DE ITEMS ====================
    const COLS = [
      { h: 'Código', w: 0.14, a: 'left' },
      { h: 'Cant', w: 0.06, a: 'right' },
      { h: 'Descripción', w: 0.32, a: 'left' },
      { h: 'P.Unitario', w: 0.11, a: 'right' },
      { h: 'Dcto', w: 0.08, a: 'right' },
      { h: 'Total', w: 0.11, a: 'right' },
    ];

    const thH = 18;
    fill(M, y, W, thH, LGR);
    bord(M, y, W, thH, 0.5);
    let cx = M;
    for (const col of COLS) {
      const cw = W * col.w;
      doc.fillColor(BK).fontSize(7).font('Helvetica-Bold')
         .text(col.h, cx + 2, y + 5, { width: cw - 4, align: col.a === 'right' ? 'right' : 'center' });
      if (cx > M) doc.moveTo(cx, y).lineTo(cx, y + thH).lineWidth(0.3).stroke(BDR);
      cx += cw;
    }
    y += thH;

    let alt = false;
    for (const item of d.items) {
      const rH = 14;
      fill(M, y, W, rH, alt ? VLGR : WHT);
      bord(M, y, W, rH, 0.25);
      cx = M;
      
      const descuentoItem = item.descuento || 0;
      const precioUnitario = item.unitPrice;
      const precioTotal = item.lineTotal;
      
      let codigo = item.codigoPrincipal || '';
      if (codigo === 'PROD-' || codigo === 'PROD') codigo = '';
      
      const rv = [
        codigo.length > 15 ? codigo.substring(0, 12) + '...' : codigo,
        item.cantidad.toFixed(2),
        item.descripcion.length > 30 ? item.descripcion.substring(0, 27) + '...' : item.descripcion,
        precioUnitario.toFixed(2),
        descuentoItem > 0 ? descuentoItem.toFixed(2) : '0.00',
        precioTotal.toFixed(2),
      ];
      
      for (let i = 0; i < COLS.length; i++) {
        const cw = W * COLS[i].w;
        const align = COLS[i].a;
        doc.fillColor(BK).fontSize(7).font('Helvetica')
           .text(rv[i], cx + 2, y + 3, { 
             width: cw - 4, 
             align: align,
             lineBreak: i === 2
           });
        cx += cw;
      }
      y += rH;
      alt = !alt;
      if (y > doc.page.height - 160) { doc.addPage(); y = M; }
    }
    
    if (d.items.length === 0) {
      fill(M, y, W, 14, WHT);
      doc.fillColor(GR).fontSize(7).text('(sin ítems registrados)', M + 6, y + 3);
      y += 14;
    }
    y += 3;

    // ==================== TOTALES ====================
    const infoW = W * 0.55;
    const totW = W - infoW - 4;
    const totX = M + infoW + 4;

    const totRows = [];
    
    // 🔥 MOSTRAR SUBTOTALES POR TASA
    const tasasOrdenadas = Object.keys(subtotalByRate)
      .map(Number)
      .sort((a, b) => b - a);

    for (const rate of tasasOrdenadas) {
      const subtotalRate = subtotalByRate[rate] || 0;
      if (subtotalRate > 0) {
        totRows.push([`SUBTOTAL ${rate}%`, subtotalRate.toFixed(2)]);
      }
    }
    
    // Descuento
    if (totalDescuento > 0) {
      totRows.push(['TOTAL DESCUENTO', `-${totalDescuento.toFixed(2)}`]);
    } else {
      totRows.push(['TOTAL DESCUENTO', '0.00']);
    }
    
    totRows.push(['ICE', '0.00']);
    
    // IVA por tasa
    const tasasConIVA = Object.keys(ivaByRate)
      .filter(rate => ivaByRate[rate] > 0)
      .map(Number)
      .sort((a, b) => b - a);
    
    for (const rate of tasasConIVA) {
      const ivaAmount = ivaByRate[rate] || 0;
      if (ivaAmount > 0) {
        totRows.push([`IVA ${rate}%`, ivaAmount.toFixed(2)]);
      }
    }
    
    totRows.push(['PROPINA', '0.00']);

    const totRowH = 12;

    let ty = y;
    for (const [label, val] of totRows) {
      fill(totX, ty, totW, totRowH, ty % 24 < 12 ? VLGR : WHT);
      bord(totX, ty, totW, totRowH, 0.3);
      doc.fillColor(BK).fontSize(7).font('Helvetica')
         .text(label, totX + 4, ty + 2, { width: totW * 0.65 })
         .text(val, totX + 4, ty + 2, { width: totW - 8, align: 'right' });
      ty += totRowH;
    }
    
    // TOTAL FINAL
    fill(totX, ty, totW, 14, BK);
    doc.fillColor(WHT).fontSize(8).font('Helvetica-Bold')
       .text('VALOR TOTAL', totX + 4, ty + 3, { width: totW * 0.65 })
       .text(total.toFixed(2), totX + 4, ty + 3, { width: totW - 8, align: 'right' });
    ty += 14;

    y = Math.max(ty, y) + 10;

    // ==================== FORMA DE PAGO ====================
    fill(M, y, W, 12, LGR);
    bord(M, y, W, 12);
    doc.fillColor(BK).fontSize(7).font('Helvetica-Bold')
       .text('Forma de Pago', M + 6, y + 3, { width: W * 0.55 })
       .text('Valor', M + W * 0.57, y + 3, { width: W * 0.14, align: 'right' })
       .text('Plazo', M + W * 0.73, y + 3, { width: W * 0.12, align: 'right' })
       .text('Tiempo', M + W * 0.87, y + 3, { width: W * 0.11, align: 'right' });
    y += 12;

    fill(M, y, W, 12, WHT);
    bord(M, y, W, 12, 0.3);
    doc.fillColor(BK).fontSize(7.5).font('Helvetica')
       .text(formaPagoLabel, M + 6, y + 3, { width: W * 0.55 })
       .text(total.toFixed(2), M + W * 0.57, y + 3, { width: W * 0.14, align: 'right' })
       .text('0', M + W * 0.73, y + 3, { width: W * 0.12, align: 'right' })
       .text('Dias', M + W * 0.87, y + 3, { width: W * 0.11, align: 'right' });
    y += 12 + 8;

    doc.fillColor(GR).fontSize(7).font('Helvetica')
       .text('Página 1 de 1', M, y, { width: W, align: 'center' });

    doc.end();
  });
}

// ------------------- NOTA DE CRÉDITO PDF -------------------
export async function generateCreditNotePdf(schema, creditNoteId) {
  const { rows } = await query(
    `SELECT * FROM "${schema}".credit_notes WHERE id = $1`, [creditNoteId]
  );
  const cn = rows[0];
  if (!cn) throw new Error('Nota de crédito no encontrada');

  const cfg = await getConfig(schema);
  const bizName = cfg?.razon_social || cfg?.nombre_comercial || 'EMPRESA';
  const ruc = cfg?.ruc || '-';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold')
       .text('NOTA DE CRÉDITO', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).font('Helvetica')
       .text(`Número: ${cn.reference_invoice || cn.id}`)
       .text(`Fecha: ${new Date(cn.created_at).toLocaleDateString('es-EC')}`)
       .text(`Cliente: ${cn.customer_name || 'CONSUMIDOR FINAL'}`)
       .text(`RUC/CI: ${cn.customer_ruc || '9999999999'}`)
       .text(`Motivo: ${cn.reason || 'Sin motivo especificado'}`);
    doc.moveDown();

    // Tabla de ítems
    const items = cn.items || [];
    if (items.length > 0) {
      doc.fontSize(10).font('Helvetica-Bold')
         .text('Detalle:', { underline: true });
      doc.moveDown(0.5);
      
      items.forEach(item => {
        const qty = item.qty || 1;
        const desc = item.description || item.name || 'Producto';
        const price = item.unit_price || 0;
        const subtotal = item.subtotal || (qty * price);
        doc.fontSize(9).font('Helvetica')
           .text(`${qty}x ${desc} - ${price.toFixed(2)} = ${subtotal.toFixed(2)}`);
      });
    }

    doc.moveDown();
    doc.fontSize(10).font('Helvetica-Bold')
       .text(`Subtotal: $${parseFloat(cn.subtotal).toFixed(2)}`)
       .text(`IVA: $${parseFloat(cn.iva_amount).toFixed(2)}`)
       .text(`TOTAL: $${parseFloat(cn.total).toFixed(2)}`)
       .text(`Saldo disponible: $${parseFloat(cn.remaining_balance).toFixed(2)}`);

    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica')
       .text('Firma del responsable:', { align: 'right' })
       .text('_________________________', { align: 'right' });

    doc.end();
  });
}