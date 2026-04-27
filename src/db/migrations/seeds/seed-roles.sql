-- Seed: roles
INSERT INTO public.roles (code, name, description, is_system) VALUES
  ('admin',    'Administrador', 'Acceso total al negocio',       TRUE),
  ('manager',  'Gerente',       'Gestión general del negocio',   TRUE),
  ('cashier',  'Cajero',        'Operador de caja',              TRUE),
  ('waiter',   'Mesero',        'Operador de órdenes y mesas',   TRUE),
  ('kitchen',  'Cocina',        'Preparación de pedidos',        TRUE),
  ('delivery', 'Repartidor',    'Entregas a domicilio',          TRUE),
  ('viewer',   'Visualizador',  'Solo lectura',                  TRUE)
ON CONFLICT (code) DO NOTHING;
