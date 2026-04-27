-- Seed: business-types
INSERT INTO public.business_types (code, name, description) VALUES
  ('restaurant', 'Restaurante',   'Restaurantes, bares, cafeterías'),
  ('retail',     'Retail/Tienda', 'Comercio minorista, tiendas generales'),
  ('services',   'Servicios',     'Peluquería, salones, servicios profesionales'),
  ('cafe',       'Cafetería',     'Cafeterías y bares de café'),
  ('delivery',   'Delivery',      'Servicios de entrega a domicilio'),
  ('pizza',      'Pizzería',      'Especializado en pizzerías'),
  ('other',      'Otro',          'Otros tipos de negocio')
ON CONFLICT (code) DO NOTHING;
