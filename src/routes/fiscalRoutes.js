import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { query } from '../config/database.js';

const router = express.Router();

// ── GET /api/fiscal/config ────────────────────────────────────────────────
router.get('/config', authMiddleware, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, country_code, country_name, currency_code, currency_name, currency_symbol,
             iva_rate, iva_rate_reduced, iva_effective_from, iva_effective_until,
             ice_enabled, sri_environment, sri_wsdl_url, sri_auth_wsdl_url,
             retention_ir_goods, retention_ir_services, retention_iva,
             is_active, created_at, updated_at
      FROM public.fiscal_config
      WHERE is_active = true
      LIMIT 1
    `);
    
    if (rows.length === 0) {
      // Si no hay configuración, devolver valores por defecto
      return res.json({
        iva_rate: 15.00,
        country_code: 'EC',
        currency_code: 'USD',
        currency_symbol: '$',
        sri_environment: 'pruebas'
      });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al obtener configuración fiscal:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/fiscal/config ────────────────────────────────────────────────
router.put('/config', authMiddleware, async (req, res) => {
  try {
    const {
      country_code,
      country_name,
      currency_code,
      currency_name,
      currency_symbol,
      iva_rate,
      iva_rate_reduced,
      iva_effective_from,
      iva_effective_until,
      ice_enabled,
      sri_environment,
      sri_wsdl_url,
      sri_auth_wsdl_url,
      retention_ir_goods,
      retention_ir_services,
      retention_iva
    } = req.body;

    const { rows } = await query(`
      UPDATE public.fiscal_config
      SET country_code = COALESCE($1, country_code),
          country_name = COALESCE($2, country_name),
          currency_code = COALESCE($3, currency_code),
          currency_name = COALESCE($4, currency_name),
          currency_symbol = COALESCE($5, currency_symbol),
          iva_rate = COALESCE($6, iva_rate),
          iva_rate_reduced = COALESCE($7, iva_rate_reduced),
          iva_effective_from = COALESCE($8, iva_effective_from),
          iva_effective_until = $9,
          ice_enabled = COALESCE($10, ice_enabled),
          sri_environment = COALESCE($11, sri_environment),
          sri_wsdl_url = COALESCE($12, sri_wsdl_url),
          sri_auth_wsdl_url = COALESCE($13, sri_auth_wsdl_url),
          retention_ir_goods = COALESCE($14, retention_ir_goods),
          retention_ir_services = COALESCE($15, retention_ir_services),
          retention_iva = COALESCE($16, retention_iva),
          updated_at = NOW()
      WHERE is_active = true
      RETURNING *
    `, [
      country_code,
      country_name,
      currency_code,
      currency_name,
      currency_symbol,
      iva_rate,
      iva_rate_reduced,
      iva_effective_from,
      iva_effective_until || null,
      ice_enabled,
      sri_environment,
      sri_wsdl_url,
      sri_auth_wsdl_url,
      retention_ir_goods,
      retention_ir_services,
      retention_iva
    ]);

    if (rows.length === 0) {
      // Si no existe, crear una nueva configuración
      const { rows: insertRows } = await query(`
        INSERT INTO public.fiscal_config (iva_rate, country_code, currency_code, currency_symbol)
        VALUES (COALESCE($1, 15), COALESCE($2, 'EC'), COALESCE($3, 'USD'), COALESCE($4, '$'))
        RETURNING *
      `, [iva_rate, country_code, currency_code, currency_symbol]);
      
      return res.json(insertRows[0]);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Error al actualizar configuración fiscal:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;