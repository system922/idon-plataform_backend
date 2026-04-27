import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';

const router = express.Router();

const rowsToObj = (rows, transform = v => v) =>
  rows.reduce((acc, { key, value }) => ({ ...acc, [key]: transform(value) }), {});

/* ─── GET /api/settings ─────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { rows } = await query(`SELECT key, value FROM "${schema}".settings ORDER BY key`);
    res.json({ data: rowsToObj(rows, v => v ?? '') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /api/settings/tax ─────────────────────────────────────────────── */
/* ⚠️  DEBE ir antes de /:key o Express la intercepta como parámetro        */
router.get('/tax', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { rows } = await query(
      `SELECT key, value FROM "${schema}".settings
       WHERE key IN ('iva_rate','vat_rate','iva_percentage','tax_rate')`
    );

    if (!rows.length) return res.json({ vat_rate: 0.15, iva_rate: 0.15, iva_percentage: 15 });

    const s          = rowsToObj(rows, parseFloat);
    const rate       = s.iva_rate ?? s.vat_rate ?? s.tax_rate ?? 15;
    const normalized = rate > 1 ? rate / 100 : rate;

    res.json({
      vat_rate:       normalized,
      iva_rate:       normalized,
      iva_percentage: Math.round(normalized * 100),
    });
  } catch {
    res.json({ vat_rate: 0.15, iva_rate: 0.15, iva_percentage: 15 });
  }
});

/* ─── GET /api/settings/receipt-info ───────────────────────────────────── */
/* ⚠️  DEBE ir antes de /:key                                               */
router.get('/receipt-info', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { rows } = await query(
      `SELECT key, value FROM "${schema}".settings
       WHERE key IN (
         'company_name','trade_name','address','city','country',
         'ruc','phone','email','tax_rate','iva_rate','currency_symbol','receipt_footer'
       )`
    );

    const s = rowsToObj(rows, v => v || '');

    res.json({
      company_name:    s.company_name    || '',
      trade_name:      s.trade_name      || '',
      address:         s.address         || '',
      city:            s.city            || '',
      country:         s.country         || 'Ecuador',
      ruc:             s.ruc             || '',
      phone:           s.phone           || '',
      email:           s.email           || '',
      tax_rate:        parseFloat(s.tax_rate || s.iva_rate) || 15,
      currency_symbol: s.currency_symbol || '$',
      receipt_footer:  s.receipt_footer  || 'DOCUMENTO SIN VALIDEZ TRIBUTARIA',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /api/settings/printers ────────────────────────────────────────── */
/* ⚠️  DEBE ir antes de /:key - obtiene AMBAS impresoras                    */
router.get('/printers', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { rows } = await query(
      `SELECT key, value FROM "${schema}".settings
       WHERE key IN ('printer_main', 'printer_ticket')`
    );

    const printers = {};
    rows.forEach(({ key, value }) => {
      try {
        printers[key] = typeof value === 'string' ? JSON.parse(value) : value || {};
      } catch {
        printers[key] = {};
      }
    });

    res.json({
      printer_main: {
        name: printers.printer_main?.name || 'POS-58',
        width: printers.printer_main?.width || 42,
        footer: printers.printer_main?.footer || '',
      },
      printer_ticket: {
        name: printers.printer_ticket?.name || 'POS-58',
        width: printers.printer_ticket?.width || 32,
        footer: printers.printer_ticket?.footer || '',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /api/settings/:key ────────────────────────────────────────────── */
/* ⚠️  DEBE ir DESPUÉS de las rutas específicas                             */
router.get('/:key', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { key } = req.params;

    const { rows } = await query(
      `SELECT key, value FROM "${schema}".settings WHERE key = $1`,
      [key]
    );

    if (!rows.length) {
      // Valores por defecto para impresoras si no existen
      if (key === 'printer_main' || key === 'printer_ticket') {
        const defaults = {
          printer_main: { name: 'POS-58', width: 42, footer: '' },
          printer_ticket: { name: 'POS-58', width: 32, footer: '' },
        };
        return res.json({ key, value: defaults[key] || {} });
      }
      return res.json({ key, value: null });
    }

    const { value } = rows[0];
    let parsedValue = value;

    // Intentar parsear JSON para impresoras
    if ((key === 'printer_main' || key === 'printer_ticket') && typeof value === 'string') {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = {};
      }
    }

    res.json({ key, value: parsedValue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── PUT /api/settings/:key ────────────────────────────────────────────── */
router.put('/:key', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { key } = req.params;
    const { value = '' } = req.body;

    // Convertir a string si es objeto (para impresoras)
    const valueToStore = typeof value === 'object' ? JSON.stringify(value) : value;

    await query(
      `INSERT INTO "${schema}".settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, valueToStore]
    );

    res.json({ success: true, key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;