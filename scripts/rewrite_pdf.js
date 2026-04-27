import { readFileSync, writeFileSync } from 'fs';

const file = 'c:/Users/JEFFERSON/idon-plataform/BACKEND/src/services/einvoicingService.js';
const src = readFileSync(file, 'utf8');

const START_MARKER = '  return new Promise((resolve, reject) => {';
const END_MARKER   = '    doc.end();\n  });\n}';

const startIdx = src.indexOf(START_MARKER);
const endIdx   = src.lastIndexOf(END_MARKER) + END_MARKER.length;

const newBlock = `  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M     = 30;
    const PW    = doc.page.width;   // 595.28
    const W     = PW - M * 2;       // 535.28
    const BK    = '#000000';
    const GR    = '#666666';
    const LGR   = '#eeeeee';
    const VLGR  = '#f9f9f9';
    const WHT   = '#ffffff';
    const BLU   = '#1a56db';
    const BDR   = '#999999';

    // helper: draw a thin border rect
    const border = (x, y2, w, h, lw = 0.5) =>
      doc.rect(x, y2, w, h).lineWidth(lw).stroke(BDR);

    // helper: fill rect
    const fillRect = (x, y2, w, h, color) =>
      doc.rect(x, y2, w, h).fill(color);

    let y = M;

    // ═══════════════════════════════════════════════════════════════════════
    //  HEADER
    // ═══════════════════════════════════════════════════════════════════════
    const leftW  = Math.round(W * 0.52);
    const rightW = W - leftW - 4;
    const rightX = M + leftW + 4;
    const hH     = 178;

    // Right panel border
    border(rightX, y, rightW, hH);

    // ── Left: logo + company info ──────────────────────────────────────────
    const LOGO_FIT = 75;
    if (logoBuf) {
      try { doc.image(logoBuf, M, y, { fit: [LOGO_FIT, LOGO_FIT] }); } catch {}
    }
    let ly = logoBuf ? y + LOGO_FIT + 4 : y + 2;

    doc.fillColor(BK).fontSize(8.5).font('Helvetica')
       .text(\`R.U.C.:   \${ruc}\`, M, ly, { width: leftW - 2 });
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
         .text(\`Dir. Matriz:  \${dirMatriz}\`, M, ly, { width: leftW - 2 });
      ly += 11;
    }
    if (d.dirEstab && d.dirEstab !== dirMatriz) {
      doc.fontSize(8).font('Helvetica')
         .text(\`Dir  \${d.dirEstab}\`, M, ly, { width: leftW - 2 });
      ly += 11;
    }
    ly += 5;
    if (cfg?.contribuyente_especial) {
      doc.fontSize(8).font('Helvetica')
         .text(\`Contribuyente Especial Resolución   \${cfg.contribuyente_especial}\`, M, ly, { width: leftW - 2 });
      ly += 11;
    }
    doc.fontSize(8).font('Helvetica')
       .text(\`OBLIGADO A LLEVAR CONTABILIDAD:   \${cfg?.obligado_contabilidad ? 'SI' : 'NO'}\`, M, ly, { width: leftW - 2 });

    // ── Right: invoice data box ────────────────────────────────────────────
    let ry = y + 10;

    doc.fillColor(BK).fontSize(13).font('Helvetica-Bold')
       .text('F  A  C  T  U  R  A', rightX, ry, { width: rightW, align: 'center' });
    ry += 20;

    doc.fillColor(BLU).fontSize(11).font('Helvetica-Bold')
       .text(\`No.   \${nroFactura}\`, rightX, ry, { width: rightW, align: 'center' });
    ry += 16;

    doc.moveTo(rightX + 6, ry).lineTo(rightX + rightW - 6, ry)
       .lineWidth(0.4).stroke(BDR);
    ry += 7;

    doc.fillColor(BK).fontSize(7.5).font('Helvetica')
       .text('NÚMERO DE AUTORIZACIÓN', rightX, ry, { width: rightW, align: 'center' });
    ry += 11;

    const authNum = inv.auth_number || claveAcceso || '';
    doc.fontSize(6).font('Courier')
       .text(authNum, rightX + 4, ry, { width: rightW - 8, align: 'center', charSpacing: 0.2 });
    ry += 11;

    const authDateStr = inv.auth_date
      ? new Date(inv.auth_date).toLocaleString('es-EC', {
          day:'2-digit', month:'2-digit', year:'numeric',
          hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false,
        })
      : (inv.emission_date
          ? new Date(inv.emission_date).toLocaleString('es-EC', {
              day:'2-digit', month:'2-digit', year:'numeric',
              hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false,
            })
          : '-');

    doc.fontSize(7).font('Helvetica')
       .text(\`FECHA Y HORA DE AUTORIZACIÓN   \${authDateStr}\`, rightX + 4, ry, { width: rightW - 8 });
    ry += 10;
    doc.text(\`AMBIENTE   \${esProduccion ? 'PRODUCCION' : 'PRUEBAS'}\`, rightX + 4, ry);
    ry += 10;
    doc.text('EMISIÓN:   NORMAL', rightX + 4, ry);
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

    // ═══════════════════════════════════════════════════════════════════════
    //  CLIENTE
    // ═══════════════════════════════════════════════════════════════════════
    const razonComp = d.razonComprador || inv.customer_name || 'CONSUMIDOR FINAL';
    const idComp    = d.idComprador    || inv.customer_ruc  || '-';
    const fechaEm   = d.fechaEmision
      || (inv.emission_date
          ? new Date(inv.emission_date).toLocaleDateString('es-EC',
              { day:'2-digit', month:'2-digit', year:'numeric' })
          : '-');

    const cliH = 30;
    border(M, y, W, cliH);

    const cW1 = W * 0.18, cW2 = W * 0.445, cW3 = W * 0.11, cW4 = W * 0.215;
    const cX1 = M + 4, cX2 = cX1 + cW1 + 2, cX3 = cX2 + cW2 + 2, cX4 = cX3 + cW3 + 2;

    doc.fontSize(7.5).font('Helvetica').fillColor(BK)
       .text('Razón Social / Nombres y', cX1, y + 4, { width: cW1 })
       .text('Fecha Emisión:', cX1, y + 17, { width: cW1 });
    doc.fontSize(8).font('Helvetica-Bold')
       .text(razonComp, cX2, y + 4, { width: cW2 })
       .text(fechaEm,   cX2, y + 17, { width: cW2 });
    doc.fontSize(7.5).font('Helvetica')
       .text('RUC / CI:', cX3, y + 4, { width: cW3 })
       .text('Guía Remisión:', cX3, y + 17, { width: cW3 });
    doc.fontSize(8).font('Helvetica-Bold')
       .text(idComp, cX4, y + 4, { width: cW4 });

    y += cliH + 2;

    // ═══════════════════════════════════════════════════════════════════════
    //  ITEMS TABLE
    // ═══════════════════════════════════════════════════════════════════════
    // Widths sum to 1.00:
    // 0.090 + 0.090 + 0.055 + 0.400 + 0.120 + 0.090 + 0.075 + 0.080 = 1.000
    const COLS = [
      { h: 'Cod. Principal',       w: 0.090, a: 'left'  },
      { h: 'Cod. Auxiliar',        w: 0.090, a: 'left'  },
      { h: 'Cant',                 w: 0.055, a: 'right' },
      { h: 'Descripción',          w: 0.400, a: 'left'  },
      { h: 'Detalles Adicionales', w: 0.120, a: 'left'
