import { query } from '../config/database.js';

export const getFiscalConfig = async () => {
  const { rows } = await query('SELECT * FROM public.fiscal_config WHERE is_active = TRUE LIMIT 1');
  return rows[0];
};

export const updateFiscalConfig = async (cfg) => {
  // Actualiza solo la fila activa
  const { rows } = await query(
    `UPDATE public.fiscal_config SET
      iva_rate = $1,
      iva_rate_reduced = $2,
      iva_effective_from = $3,
      retention_ir_goods = $4,
      retention_ir_services = $5,
      retention_iva = $6,
      sri_environment = $7,
      currency_code = $8,
      currency_symbol = $9,
      country_name = $10,
      country_code = $11,
      updated_at = NOW()
     WHERE is_active = TRUE
     RETURNING *`,
    [
      cfg.iva_rate,
      cfg.iva_rate_reduced,
      cfg.iva_effective_from,
      cfg.retention_ir_goods,
      cfg.retention_ir_services,
      cfg.retention_iva,
      cfg.sri_environment,
      cfg.currency_code,
      cfg.currency_symbol,
      cfg.country_name,
      cfg.country_code
    ]
  );
  return rows[0];
};