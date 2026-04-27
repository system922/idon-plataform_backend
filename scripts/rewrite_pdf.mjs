import { readFileSync, writeFileSync } from 'fs';

const file = 'c:/Users/JEFFERSON/idon-plataform/BACKEND/src/services/einvoicingService.js';
const src  = readFileSync(file, 'utf8');

const START = '  return new Promise((resolve, reject) => {';
const END   = '    doc.end();\n  });\n}';

const si = src.indexOf(START);
const ei = src.lastIndexOf(END) + END.length;

const newBlock = `  return new Promise((resolve, reject) => {
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
      { h: 'Precio\\nUnitario',   w: 0.090, a: 'right' },
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
         .text(col.h.replace('\\\\n', '\n'), cx + 2, y + 4, { width: cw - 4, align: 'center', lineGap: 0 });
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
}`;

const result = src.substring(0, si) + newBlock + '\n';
writeFileSync(file, result, 'utf8');
console.log('Rewritten OK. Lines:', result.split('\n').length);
