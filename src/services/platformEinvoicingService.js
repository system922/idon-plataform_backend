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
  'ruc', 'razon_social', 'nombre_comercial', 'direccion_matriz',
  'direccion_establecimiento', 'contribuyente_especial', 'obligado_contabilidad',
  'ambiente', 'serie_estab', 'serie_pto_emision', 'secuencial_actual',
  'secuencial_credit_notes',
];

const IVA_CODES = { 0: 0, 5: 5, 8: 6, 12: 2, 15: 4 };

function pad(value, length) {
  return String(value).padStart(length, '0');
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// ── HELPERS COPIADOS DE einvoicingService.js PARA EL PDF ──
async function parseFacturaFromXml(xmlText) {
  const { parseStringPromise } = await import('xml2js');
  const parsed = await parseStringPromise(xmlText, { explicitArray: false, ignoreAttrs: false });

  const root = parsed['factura'] || parsed['ns0:factura'] || parsed;
  const factura = root?.infoTributaria ? root : parsed?.factura ?? Object.values(parsed).find(v => v?.infoTributaria) ?? root;

  const str = v => (typeof v === 'object' ? v?._ ?? Object.values(v)[0] : v) ?? '';
  const num = v => parseFloat(str(v)) || 0;

  const it = factura?.infoTributaria ?? {};
  const inf = factura?.infoFactura ?? {};

  let rawDetalles = factura?.detalles?.detalle ?? [];
  if (!Array.isArray(rawDetalles)) rawDetalles = [rawDetalles];

  const codigoPorcentajeMap = { '0': 0, '2': 12, '4': 15, '5': 5, '6': 8, '7': 0 };

  const items = rawDetalles.map(d => {
    let rawImp = d?.impuestos?.impuesto ?? [];
    if (!Array.isArray(rawImp)) rawImp = [rawImp];
    const ivaImp = rawImp.find(i => str(i?.codigo) === '2') || rawImp[0] || {};
    
    let tarifa = 0;
    const tarifaRaw = num(ivaImp?.tarifa);
    if (tarifaRaw > 0) {
      if (tarifaRaw <= 1) tarifa = Math.round(tarifaRaw * 100);
      else if (tarifaRaw <= 100) tarifa = Math.round(tarifaRaw);
      else tarifa = 15;
    }
    if (tarifa === 0) {
      tarifa = codigoPorcentajeMap[str(ivaImp?.codigoPorcentaje)] ?? 0;
    }
    
    return {
      codigoPrincipal: str(d?.codigoPrincipal),
      descripcion: str(d?.descripcion),
      cantidad: num(d?.cantidad),
      unitPrice: num(d?.precioUnitario),
      descuento: num(d?.descuento),
      lineTotal: num(d?.precioTotalSinImpuesto),
      ivaRate: tarifa,
      ivaValue: num(ivaImp?.valor),
    };
  });

  const subtotalByRate = {};
  const ivaByRate = {};
  for (const item of items) {
    subtotalByRate[item.ivaRate] = (subtotalByRate[item.ivaRate] || 0) + item.lineTotal;
    ivaByRate[item.ivaRate] = (ivaByRate[item.ivaRate] || 0) + item.ivaValue;
  }

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
    razonComprador: str(inf?.razonSocialComprador),
    idComprador: str(inf?.identificacionComprador),
    subtotal: num(inf?.totalSinImpuestos),
    totalDescuento: num(inf?.totalDescuento || 0),
    total: num(inf?.importeTotal),
    formaPago: str(inf?.pagos?.pago?.formaPago ?? inf?.pagos?.pago?.[0]?.formaPago),
    items,
    subtotalByRate,
    ivaByRate,
  };
}

async function generateBarcode(text) {
  try {
    const bwipjs = await import('bwip-js');
    const fn = bwipjs.default?.toBuffer || bwipjs.toBuffer;
    return await fn({ bcid: 'code128', text, scale: 2, height: 10, includetext: false, backgroundcolor: 'ffffff' });
  } catch { return null; }
}

// ── CONFIGURACIÓN BÁSICA ──
export async function getPlatformEinvoicingConfig() {
  const { rows } = await query('SELECT * FROM public.platform_einvoice_config WHERE id = 1');
  return rows[0] || null;
}

export async function savePlatformEinvoicingConfig(data) {
  const values = CONFIG_FIELDS.map((field) => {
    if (field === 'secuencial_actual' || field === 'secuencial_credit_notes') return data[field] == null ? null : parseInt(data[field], 10);
    return data[field] == null ? null : data[field];
  });
  const assignments = CONFIG_FIELDS.map((field, index) => `${field} = COALESCE($${index + 1}, ${field})`).join(', ');
  const { rows } = await query(`UPDATE public.platform_einvoice_config SET ${assignments}, updated_at = NOW() WHERE id = 1 RETURNING *`, values);
  return rows[0] || null;
}

export async function savePlatformSignature(buffer, password) {
  const { rows } = await query(`
    UPDATE public.platform_einvoice_config SET p12_base64 = $1, p12_password = $2, has_signature = TRUE, updated_at = NOW() WHERE id = 1 RETURNING *
  `, [buffer.toString('base64'), password]);
  return rows[0] || null;
}

// ── EMISIÓN DE FACTURA ──
export async function emitPlatformInvoice(opts) {
  const client = await getClient();
  let invoice, signedXml, accessKey, envName;
  try {
    await client.query('BEGIN');
    const { rows: configRows } = await client.query('SELECT * FROM public.platform_einvoice_config WHERE id = 1 FOR UPDATE');
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
        pagos: { pago: [{ formaPago: opts.forma_pago || '20', total }] },
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

    await client.query('UPDATE public.platform_einvoice_config SET secuencial_actual = $1, updated_at = NOW() WHERE id = 1', [secuencial + 1]);
    
    const { rows } = await client.query(`
      INSERT INTO public.platform_einvoices
        (billing_history_id, invoice_number, access_key, customer_name, customer_ruc,
         customer_email, subtotal, iva_amount, total, items, signed_xml, status,
         emission_date, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pendiente', $12, NOW())
      RETURNING *
    `, [
      opts.billing_history_id, invoiceNumber, accessKey, customer.name || 'CONSUMIDOR FINAL',
      customer.ruc || '9999999999999', customer.email || null, subtotal, ivaAmount, total,
      JSON.stringify(items), signedXml, now,
    ]);
    invoice = rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  authorizePlatformInvoice(invoice, signedXml, accessKey, envName)
    .catch((error) => logger.error({ err: error, invoiceId: invoice.id }, 'Platform SRI authorization failed'));
  return invoice;
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
        sriMessage = (authorization?.mensajes || []).map((message) => message.mensaje).join(' | ') || authorization?.estadoAutorizacion || 'Rechazada por el SRI';
      }
    } else {
      sriMessage = received?.mensaje || 'No recibida por el SRI';
    }
  } catch (error) {
    sriMessage = error.message;
  }

  const { rows } = await query(`
    UPDATE public.platform_einvoices SET status = $1, auth_number = $2, auth_date = $3, sri_message = $4, sri_json = $5, updated_at = NOW()
    WHERE id = $6 RETURNING *
  `, [status, authNumber, authDate, sriMessage, sriJson ? JSON.stringify(sriJson) : null, invoice.id]);
  
  const updatedInvoice = rows[0];
  if (!updatedInvoice) return;
  
  await query('UPDATE public.billing_history SET invoice_status = $1, invoice_error = $2 WHERE id = $3', [status, sriMessage, invoice.billing_history_id]);

  if (status === 'autorizada' && updatedInvoice.customer_email) {
    try {
      const config = await getPlatformEinvoicingConfig();
      const emitterName = config?.nombre_comercial || config?.razon_social || 'IDON';
      const pdf = await generatePlatformInvoicePdf(updatedInvoice.id);
      await sendInvoiceEmail(updatedInvoice, pdf, updatedInvoice.customer_email, emitterName);
    } catch (error) {
      logger.error({ err: error, invoiceId: updatedInvoice.id }, 'Could not send platform invoice email');
    }
  }
}

// ── PDF IDÉNTICO AL DE LOS NEGOCIOS ──
export async function generatePlatformInvoicePdf(invoiceId) {
  const { rows: invRows } = await query('SELECT * FROM public.platform_einvoices WHERE id = $1', [invoiceId]);
  const inv = invRows[0];
  if (!inv) throw new Error('Factura de IDON no encontrada');
  if (!inv.signed_xml) throw new Error('XML firmado no disponible');

  const d = await parseFacturaFromXml(inv.signed_xml);
  const cfg = await getPlatformEinvoicingConfig();
  const barcodeBuf = await generateBarcode(d.claveAcceso || inv.access_key);

  const subtotalByRate = {};
  const ivaByRate = {};
  for (const item of d.items) {
    subtotalByRate[item.ivaRate] = (subtotalByRate[item.ivaRate] || 0) + item.lineTotal;
    ivaByRate[item.ivaRate] = (ivaByRate[item.ivaRate] || 0) + item.ivaValue;
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

    // HEADER
    const leftW = Math.round(W * 0.52);
    const rightW = W - leftW - 4;
    const rightX = M + leftW + 4;
    const hH = 178;
    bord(rightX, y, rightW, hH, 0.8);

    let ly = y + 2;
    doc.fillColor(BK).fontSize(8.5).font('Helvetica').text('R.U.C.:   ' + d.ruc, M, ly, { width: leftW - 2 });
    ly += 12;
    doc.fontSize(9).font('Helvetica-Bold').text(d.razonSocial, M, ly, { width: leftW - 2 });
    ly += 13;
    if (d.nombreComercial && d.nombreComercial !== d.razonSocial) {
      doc.fontSize(8).font('Helvetica').text(d.nombreComercial, M, ly, { width: leftW - 2 });
      ly += 11;
    }
    if (d.dirMatriz) {
      doc.fontSize(8).font('Helvetica').text('Dir. Matriz:  ' + d.dirMatriz, M, ly, { width: leftW - 2 });
      ly += 11;
    }
    ly += 5;
    doc.fontSize(8).font('Helvetica').text('OBLIGADO A LLEVAR CONTABILIDAD:   ' + (cfg?.obligado_contabilidad ? 'SI' : 'NO'), M, ly, { width: leftW - 2 });

    let ry = y + 10;
    doc.fillColor(BK).fontSize(13).font('Helvetica-Bold').text('F  A  C  T  U  R  A', rightX, ry, { width: rightW, align: 'center' });
    ry += 20;
    doc.fillColor(BLU).fontSize(11).font('Helvetica-Bold').text('No.   ' + inv.invoice_number, rightX, ry, { width: rightW, align: 'center' });
    ry += 16;
    doc.moveTo(rightX + 6, ry).lineTo(rightX + rightW - 6, ry).lineWidth(0.4).stroke(BDR);
    ry += 7;
    doc.fillColor(BK).fontSize(7.5).font('Helvetica').text('NÚMERO DE AUTORIZACIÓN', rightX, ry, { width: rightW, align: 'center' });
    ry += 11;
    
    const authNum = inv.auth_number || d.claveAcceso || '';
    doc.fontSize(6).font('Courier').text(authNum, rightX + 4, ry, { width: rightW - 8, align: 'center', charSpacing: 0.2 });
    ry += 11;
    
    const authDateStr = inv.auth_date ? new Date(inv.auth_date).toLocaleString('es-EC') : '-';
    doc.fontSize(7).font('Helvetica').fillColor(BK).text('FECHA Y HORA DE AUTORIZACIÓN   ' + authDateStr, rightX + 4, ry, { width: rightW - 8 });
    ry += 10;
    doc.text('AMBIENTE   ' + (d.ambiente === '2' ? 'PRODUCCION' : 'PRUEBAS'), rightX + 4, ry, { width: rightW - 8 });
    ry += 10;
    doc.text('EMISIÓN:   NORMAL', rightX + 4, ry, { width: rightW - 8 });
    ry += 10;
    doc.fontSize(7.5).font('Helvetica').text('CLAVE DE ACCESO', rightX, ry, { width: rightW, align: 'center' });
    ry += 8;

    if (barcodeBuf) {
      try { doc.image(barcodeBuf, rightX + 5, ry, { width: rightW - 10, height: 28 }); } catch { }
      ry += 30;
    }
    doc.fontSize(5.8).font('Courier').fillColor(BK).text(d.claveAcceso || '', rightX + 4, ry, { width: rightW - 8, align: 'center', charSpacing: 0.2 });

    y = M + hH + 4;

    // CLIENTE
    const cliH = 35;
    bord(M, y, W, cliH);
    const cW1 = W * 0.18, cW2 = W * 0.32, cW3 = W * 0.18, cW4 = W * 0.27;
    const cX1 = M + 4, cX2 = cX1 + cW1 + 2, cX3 = cX2 + cW2 + 2, cX4 = cX3 + cW3 + 2;

    doc.fontSize(7.5).font('Helvetica').fillColor(BK).text('Razón Social / Nombres', cX1, y + 4, { width: cW1 });
    doc.fontSize(8).font('Helvetica-Bold').text(d.razonComprador || inv.customer_name || 'CONSUMIDOR FINAL', cX2, y + 4, { width: cW2 });
    doc.fontSize(7.5).font('Helvetica').text('RUC / CI:', cX3, y + 4, { width: cW3 });
    doc.fontSize(8).font('Helvetica-Bold').text(d.idComprador || inv.customer_ruc || '-', cX4, y + 4, { width: cW4 });

    doc.fontSize(7.5).font('Helvetica').text('Fecha Emisión:', cX1, y + 20, { width: cW1 });
    doc.fontSize(8).font('Helvetica-Bold').text(d.fechaEmision || new Date(inv.emission_date).toLocaleDateString('es-EC'), cX2, y + 20, { width: cW2 });

    if (inv.customer_email) {
      doc.fontSize(7.5).font('Helvetica').text('Correo Electrónico:', cX3, y + 20, { width: cW3 });
      doc.fontSize(8).font('Helvetica').text(inv.customer_email, cX4, y + 20, { width: cW4 });
    }
    y += cliH + 2;

    // TABLA
    const COLS = [
      { h: 'Código', w: 0.14, a: 'left' },
      { h: 'Cant', w: 0.06, a: 'right' },
      { h: 'Descripción', w: 0.32, a: 'left' },
      { h: 'P.Unitario', w: 0.11, a: 'right' },
      { h: 'Dcto', w: 0.08, a: 'right' },
      { h: 'Total', w: 0.11, a: 'right' },
    ];
    const thH = 18;
    const drawItemsHeader = () => {
      fill(M, y, W, thH, LGR);
      bord(M, y, W, thH, 0.5);
      let headerX = M;
      for (const col of COLS) {
        const cw = W * col.w;
        doc.fillColor(BK).fontSize(7).font('Helvetica-Bold').text(col.h, headerX + 2, y + 5, { width: cw - 4, align: col.a === 'right' ? 'right' : 'center' });
        if (headerX > M) doc.moveTo(headerX, y).lineTo(headerX, y + thH).lineWidth(0.3).stroke(BDR);
        headerX += cw;
      }
      y += thH;
    };
    drawItemsHeader();

    let alt = false;
    for (const item of d.items) {
      const descripcion = item.descripcion || '';
      const descripcionWidth = W * COLS[2].w - 4;
      doc.font('Helvetica').fontSize(7);
      const descripcionHeight = doc.heightOfString(descripcion, { width: descripcionWidth });
      const rH = Math.max(14, Math.ceil(descripcionHeight) + 6);

      if (y + rH > doc.page.height - 160) {
        doc.addPage();
        y = M;
        drawItemsHeader();
      }

      fill(M, y, W, rH, alt ? VLGR : WHT);
      bord(M, y, W, rH, 0.25);
      let cx = M;
      const rv = [
        item.codigoPrincipal ? item.codigoPrincipal.substring(0, 15) : '',
        item.cantidad.toFixed(2),
        descripcion,
        item.unitPrice.toFixed(2),
        item.descuento > 0 ? item.descuento.toFixed(2) : '0.00',
        item.lineTotal.toFixed(2),
      ];
      
      for (let i = 0; i < COLS.length; i++) {
        const cw = W * COLS[i].w;
        const textY = i === 2 ? y + 3 : y + Math.max(3, (rH - 8) / 2);
        doc.fillColor(BK).fontSize(7).font('Helvetica').text(rv[i], cx + 2, textY, { width: cw - 4, align: COLS[i].a, lineBreak: i === 2 });
        cx += cw;
      }
      y += rH;
      alt = !alt;
    }
    y += 3;

    // TOTALES
    const infoW = W * 0.55;
    const totW = W - infoW - 4;
    const totX = M + infoW + 4;
    const totRows = [];
    
    for (const rate of ivaRates) {
      const subtotalRate = subtotalByRate[rate] || 0;
      if (subtotalRate > 0) totRows.push([`SUBTOTAL ${rate}%`, subtotalRate.toFixed(2)]);
    }
    totRows.push(['SUBTOTAL SIN IMPUESTOS', d.subtotal.toFixed(2)]);
    totRows.push(['TOTAL DESCUENTO', d.totalDescuento > 0 ? `-${d.totalDescuento.toFixed(2)}` : '0.00']);
    totRows.push(['ICE', '0.00']);
    for (const rate of ivaRates) {
      const ivaAmount = ivaByRate[rate] || 0;
      if (ivaAmount > 0) totRows.push([`IVA ${rate}%`, ivaAmount.toFixed(2)]);
    }
    totRows.push(['PROPINA', '0.00']);

    let ty = y;
    for (const [label, val] of totRows) {
      fill(totX, ty, totW, 12, ty % 24 < 12 ? VLGR : WHT);
      bord(totX, ty, totW, 12, 0.3);
      doc.fillColor(BK).fontSize(7).font('Helvetica').text(label, totX + 4, ty + 2, { width: totW * 0.65 }).text(val, totX + 4, ty + 2, { width: totW - 8, align: 'right' });
      ty += 12;
    }
    fill(totX, ty, totW, 14, BK);
    doc.fillColor(WHT).fontSize(8).font('Helvetica-Bold').text('VALOR TOTAL', totX + 4, ty + 3, { width: totW * 0.65 }).text(d.total.toFixed(2), totX + 4, ty + 3, { width: totW - 8, align: 'right' });
    ty += 14;
    y = Math.max(ty, y) + 10;

    // FORMA DE PAGO
    fill(M, y, W, 12, LGR);
    bord(M, y, W, 12);
    doc.fillColor(BK).fontSize(7).font('Helvetica-Bold').text('Forma de Pago', M + 6, y + 3, { width: W * 0.55 }).text('Valor', M + W * 0.57, y + 3, { width: W * 0.14, align: 'right' }).text('Plazo', M + W * 0.73, y + 3, { width: W * 0.12, align: 'right' }).text('Tiempo', M + W * 0.87, y + 3, { width: W * 0.11, align: 'right' });
    y += 12;
    
    const FORMA_PAGO_LABELS = { '01': 'SIN UTILIZACIÓN DEL SISTEMA FINANCIERO', '19': 'TARJETA DE CRÉDITO', '20': 'OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO' };
    const formaPagoLabel = FORMA_PAGO_LABELS[d.formaPago] || 'SIN UTILIZACIÓN DEL SISTEMA FINANCIERO';
    
    fill(M, y, W, 12, WHT);
    bord(M, y, W, 12, 0.3);
    doc.fillColor(BK).fontSize(7.5).font('Helvetica').text(formaPagoLabel, M + 6, y + 3, { width: W * 0.55 }).text(d.total.toFixed(2), M + W * 0.57, y + 3, { width: W * 0.14, align: 'right' }).text('0', M + W * 0.73, y + 3, { width: W * 0.12, align: 'right' }).text('Dias', M + W * 0.87, y + 3, { width: W * 0.11, align: 'right' });
    y += 12 + 8;

    doc.fillColor(GR).fontSize(7).font('Helvetica').text('Página 1 de 1', M, y, { width: W, align: 'center' });
    doc.end();
  });
}