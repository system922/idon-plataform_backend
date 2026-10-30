import PDFDocument from 'pdfkit';
import {
  authorizeXml,
  generateXmlInvoice,
  signXml,
  validateXml,
} from 'osodreamer-sri-xml-signer';
import { query, getClient } from '../config/database.js';
import logger from '../utils/logger.js';
import { sendInvoiceEmail } from './emailService.js';

const CONFIG_FIELDS = [
  'ruc',
  'razon_social',
  'nombre_comercial',
  'direccion_matriz',
  'direccion_establecimiento',
  'contribuyente_especial',
  'obligado_contabilidad',
  'ambiente',
  'serie_estab',
  'serie_pto_emision',
  'secuencial_actual',
  'secuencial_credit_notes',
];

const IVA_CODES = { 0: 0, 5: 5, 8: 6, 12: 2, 15: 4 };

function pad(value, length) {
  return String(value).padStart(length, '0');
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export async function getPlatformEinvoicingConfig() {
  const { rows } = await query('SELECT * FROM public.platform_einvoice_config WHERE id = 1');
  return rows[0] || null;
}

export async function savePlatformEinvoicingConfig(data) {
  const values = CONFIG_FIELDS.map((field) => {
    if (field === 'secuencial_actual' || field === 'secuencial_credit_notes') {
      return data[field] == null ? null : parseInt(data[field], 10);
    }
    return data[field] == null ? null : data[field];
  });
  const assignments = CONFIG_FIELDS
    .map((field, index) => `${field} = COALESCE($${index + 1}, ${field})`)
    .join(', ');
  const { rows } = await query(`
    UPDATE public.platform_einvoice_config
       SET ${assignments}, updated_at = NOW()
     WHERE id = 1
     RETURNING *
  `, values);
  return rows[0] || null;
}

export async function savePlatformSignature(buffer, password) {
  const { rows } = await query(`
    UPDATE public.platform_einvoice_config
       SET p12_base64 = $1, p12_password = $2, has_signature = TRUE, updated_at = NOW()
     WHERE id = 1
     RETURNING *
  `, [buffer.toString('base64'), password]);
  return rows[0] || null;
}

export async function emitPlatformInvoice(opts) {
  const client = await getClient();
  let invoice;
  let signedXml;
  let accessKey;
  let envName;
  try {
    await client.query('BEGIN');
    const { rows: configRows } = await client.query(
      'SELECT * FROM public.platform_einvoice_config WHERE id = 1 FOR UPDATE'
    );
    const config = configRows[0];
    if (!config?.ruc || !config.razon_social) throw new Error('Complete los datos del emisor IDON');
    if (!config.p12_base64) throw new Error('Cargue la firma electrónica de IDON');

    const items = Array.isArray(opts.items) ? opts.items : [];
    if (!items.length) throw new Error('La factura debe incluir al menos un detalle');
    const subtotal = round(opts.subtotal);
    const ivaAmount = round(opts.iva_amount);
    const total = round(opts.total);
    if (subtotal < 0 || ivaAmount < 0 || total <= 0) throw new Error('Los valores de la factura no son válidos');

    const secuencial = Number(config.secuencial_actual) || 1;
    const establecimiento = config.serie_estab || '001';
    const puntoEmision = config.serie_pto_emision || '001';
    const ambiente = config.ambiente || '1';
    const environmentNumber = parseInt(ambiente, 10);
    envName = environmentNumber === 2 ? 'prod' : 'test';
    const invoiceNumber = `${establecimiento}-${puntoEmision}-${pad(secuencial, 9)}`;
    const now = new Date();
    const customer = opts.customer || {};
    const ivaGroups = {};
    const details = items.map((item) => {
      const quantity = Number(item.qty || item.quantity || 1);
      const unitPrice = round(item.unit_price || 0);
      const lineSubtotal = round(item.subtotal ?? quantity * unitPrice);
      const lineIva = round(item.iva_amount || 0);
      const rate = Number(item.iva_rate_pct) || 0;
      const code = IVA_CODES[rate] ?? IVA_CODES[15];
      if (!ivaGroups[code]) ivaGroups[code] = { base: 0, value: 0 };
      ivaGroups[code].base += lineSubtotal;
      ivaGroups[code].value += lineIva;
      return {
        codigoPrincipal: item.code || 'IDON',
        codigoAuxiliar: item.code || 'IDON',
        descripcion: item.description || 'Servicio de suscripción IDON',
        cantidad: quantity,
        precioUnitario: unitPrice,
        descuento: 0,
        precioTotalSinImpuesto: lineSubtotal,
        impuestos: {
          impuesto: [{
            codigo: 2,
            codigoPorcentaje: code,
            tarifa: rate,
            baseImponible: lineSubtotal,
            valor: lineIva,
          }],
        },
      };
    });
    const taxTotals = Object.entries(ivaGroups).map(([code, amounts]) => ({
      codigo: 2,
      codigoPorcentaje: Number(code),
      baseImponible: round(amounts.base),
      valor: round(amounts.value),
    }));

    const comprobante = {
      infoTributaria: {
        ruc: config.ruc,
        ambiente: environmentNumber,
        dirMatriz: config.direccion_matriz || 'Ecuador',
        estab: establecimiento,
        ptoEmi: puntoEmision,
        secuencial: pad(secuencial, 9),
        razonSocial: config.razon_social,
        ...(config.nombre_comercial ? { nombreComercial: config.nombre_comercial } : {}),
      },
      infoFactura: {
        fechaEmision: now,
        dirEstablecimiento: config.direccion_establecimiento || config.direccion_matriz || 'Ecuador',
        ...(config.contribuyente_especial ? { contribuyenteEspecial: config.contribuyente_especial } : {}),
        obligadoContabilidad: config.obligado_contabilidad ? 'SI' : 'NO',
        tipoIdentificacionComprador: customer.tipo_identificacion || '07',
        razonSocialComprador: customer.name || 'CONSUMIDOR FINAL',
        identificacionComprador: customer.ruc || '9999999999999',
        totalSinImpuestos: subtotal,
        totalDescuento: 0,
        propina: 0,
        importeTotal: total,
        moneda: 'USD',
        totalConImpuestos: { totalImpuesto: taxTotals },
        pagos: {
          pago: [{ formaPago: opts.forma_pago || '20', total }],
        },
      },
      detalles: { detalle: details },
    };

    const { generatedXml } = await generateXmlInvoice(comprobante);
    accessKey = generatedXml.match(/<claveAcceso>([^<]+)<\/claveAcceso>/)?.[1] || '';
    if (!accessKey) throw new Error('No se pudo generar la clave de acceso del comprobante');
    signedXml = await signXml({
      p12Buffer: new Uint8Array(Buffer.from(config.p12_base64, 'base64')),
      password: config.p12_password || '',
      xmlBuffer: new TextEncoder().encode(generatedXml),
    });

    await client.query(
      'UPDATE public.platform_einvoice_config SET secuencial_actual = $1, updated_at = NOW() WHERE id = 1',
      [secuencial + 1]
    );
    const { rows } = await client.query(`
      INSERT INTO public.platform_einvoices
        (billing_history_id, invoice_number, access_key, customer_name, customer_ruc,
         customer_email, subtotal, iva_amount, total, items, signed_xml, status,
         emission_date, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pendiente', $12, NOW())
      RETURNING *
    `, [
      opts.billing_history_id,
      invoiceNumber,
      accessKey,
      customer.name || 'CONSUMIDOR FINAL',
      customer.ruc || '9999999999999',
      customer.email || null,
      subtotal,
      ivaAmount,
      total,
      JSON.stringify(items),
      signedXml,
      now,
    ]);
    invoice = rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return authorizePlatformInvoice(invoice, signedXml, accessKey, envName);
}

async function authorizePlatformInvoice(invoice, signedXml, accessKey, environment) {
  let status = 'pendiente';
  let authNumber = null;
  let authDate = null;
  let sriMessage = null;
  let sriJson = null;
  try {
    const received = await validateXml({ xml: new TextEncoder().encode(signedXml), env: environment });
    if (received?.estado === 'RECIBIDA') {
      const authorization = await authorizeXml({ claveAcceso: accessKey, env: environment });
      sriJson = authorization;
      if (authorization?.estadoAutorizacion === 'AUTORIZADO') {
        status = 'autorizada';
        authNumber = authorization.claveAcceso || accessKey;
        authDate = authorization.fechaAutorizacion ? new Date(authorization.fechaAutorizacion) : new Date();
      } else {
        status = 'rechazada';
        sriMessage = (authorization?.mensajes || []).map((message) => message.mensaje).join(' | ')
          || authorization?.estadoAutorizacion || 'Rechazada por el SRI';
      }
    } else {
      sriMessage = received?.mensaje || 'No recibida por el SRI';
    }
  } catch (error) {
    sriMessage = error.message;
  }

  const { rows } = await query(`
    UPDATE public.platform_einvoices
       SET status = $1, auth_number = $2, auth_date = $3,
           sri_message = $4, sri_json = $5, updated_at = NOW()
     WHERE id = $6
     RETURNING *
  `, [status, authNumber, authDate, sriMessage, sriJson ? JSON.stringify(sriJson) : null, invoice.id]);
  const updatedInvoice = rows[0];
  if (!updatedInvoice) return;
  await query(
    'UPDATE public.billing_history SET invoice_status = $1, invoice_error = $2 WHERE id = $3',
    [status, sriMessage, invoice.billing_history_id]
  );

  if (status === 'autorizada') {
    if (!updatedInvoice.customer_email) {
      throw new Error('La factura fue autorizada, pero no tiene correo de cliente para enviarla');
    }
    try {
      const config = await getPlatformEinvoicingConfig();
      const emitterName = config?.nombre_comercial || config?.razon_social || 'IDON';
      const pdf = await generatePlatformInvoicePdf(updatedInvoice.id);
      await sendInvoiceEmail(updatedInvoice, pdf, updatedInvoice.customer_email, emitterName);
    } catch (error) {
      logger.error({ err: error, invoiceId: updatedInvoice.id }, 'Could not send platform invoice email');
      throw new Error(`Factura autorizada, pero no se pudo enviar al correo ${updatedInvoice.customer_email}: ${error.message}`);
    }
  }
  return updatedInvoice;
}

export async function generatePlatformInvoicePdf(invoiceId) {
  const { rows } = await query('SELECT * FROM public.platform_einvoices WHERE id = $1', [invoiceId]);
  const invoice = rows[0];
  if (!invoice) throw new Error('Factura de IDON no encontrada');
  if (!invoice.signed_xml) throw new Error('XML firmado no disponible');
  const config = await getPlatformEinvoicingConfig();
  const items = Array.isArray(invoice.items) ? invoice.items : [];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(17).font('Helvetica-Bold').text(config?.razon_social || 'IDON');
    doc.moveDown(0.3).fontSize(9).font('Helvetica')
      .text(`RUC: ${config?.ruc || '—'}`)
      .text(`Dirección: ${config?.direccion_matriz || '—'}`);
    doc.moveDown().fontSize(15).font('Helvetica-Bold').text('FACTURA ELECTRÓNICA', { align: 'right' });
    doc.fontSize(10).font('Helvetica').text(`No. ${invoice.invoice_number}`, { align: 'right' });
    doc.text(`Emisión: ${new Date(invoice.emission_date).toLocaleDateString('es-EC')}`, { align: 'right' });
    doc.moveDown().moveTo(44, doc.y).lineTo(551, doc.y).stroke();
    doc.moveDown(0.8).font('Helvetica-Bold').text('Cliente');
    doc.font('Helvetica').text(invoice.customer_name || 'CONSUMIDOR FINAL');
    doc.text(`Identificación: ${invoice.customer_ruc || '9999999999999'}`);
    doc.text(`Correo: ${invoice.customer_email || '—'}`);
    doc.moveDown().font('Helvetica-Bold').text('Detalle');
    doc.moveDown(0.4);

    for (const item of items) {
      const quantity = Number(item.qty || item.quantity || 1);
      const lineTotal = Number(item.subtotal || 0) + Number(item.iva_amount || 0);
      doc.font('Helvetica').text(`${item.description || 'Servicio de suscripción IDON'}  x${quantity}`);
      doc.text(`$${lineTotal.toFixed(2)}`, { align: 'right' });
    }

    doc.moveDown().moveTo(330, doc.y).lineTo(551, doc.y).stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica').text(`Subtotal: $${Number(invoice.subtotal).toFixed(2)}`, { align: 'right' });
    doc.text(`IVA: $${Number(invoice.iva_amount).toFixed(2)}`, { align: 'right' });
    doc.font('Helvetica-Bold').fontSize(12).text(`TOTAL: $${Number(invoice.total).toFixed(2)}`, { align: 'right' });
    doc.moveDown().font('Helvetica').fontSize(8)
      .text(`Clave de acceso: ${invoice.access_key || '—'}`, { lineBreak: true })
      .text(`Autorización SRI: ${invoice.auth_number || invoice.status}`);
    doc.end();
  });
}
