-- Seed: configuración fiscal Ecuador
INSERT INTO public.fiscal_config (
  country_code, country_name,
  currency_code, currency_name, currency_symbol,
  iva_rate, iva_rate_reduced, iva_effective_from,
  ice_enabled,
  sri_environment,
  sri_wsdl_url, sri_auth_wsdl_url,
  retention_ir_goods, retention_ir_services, retention_iva,
  is_active
) VALUES (
  'EC', 'Ecuador',
  'USD', 'Dólar Estadounidense', '$',
  15.00, 0.00, '2024-04-01',
  FALSE,
  'produccion',
  'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl',
  'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl',
  1.00, 2.00, 30.00,
  TRUE
) ON CONFLICT DO NOTHING;
