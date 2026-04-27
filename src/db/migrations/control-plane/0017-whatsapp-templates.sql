-- Plantillas de mensajes WhatsApp para notificaciones IDON
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  type        VARCHAR(50)  PRIMARY KEY,
  label       VARCHAR(200) NOT NULL,
  description TEXT,
  body        TEXT         NOT NULL,
  variables   TEXT[]       NOT NULL DEFAULT '{}',
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO public.whatsapp_templates (type, label, description, body, variables) VALUES

('registro',
 'Bienvenida de Registro',
 'Se envía al dueño del negocio cuando crea su cuenta en la plataforma.',
 E'👋 *¡Bienvenido a IDON!*\n_Plataforma de Gestión Multi-Negocios_\n\nHola *{{firstName}} {{lastName}}*, tu solicitud de registro ha sido recibida exitosamente. ✅\n\n📋 *Datos registrados:*\n👤 Nombre: {{firstName}} {{lastName}}\n📧 Email: {{email}}\n🏢 Negocio: {{businessName}}\n🔗 Identificador: {{businessSlug}}\n\n⏳ Tu cuenta está *pendiente de aprobación* por el equipo IDON.\nRecibirás una notificación en cuanto sea activada.\n📞 *Soporte IDON:* wa.me/{{supportNumber}}\n\n_IDON — Sistema Integral de Gestión de Negocios_',
 ARRAY['firstName','lastName','email','businessName','businessSlug','supportNumber']),

('aprobacion',
 'Aprobación de Negocio',
 'Se envía cuando el administrador IDON aprueba y activa el negocio.',
 E'🎉 *¡Tu negocio ha sido APROBADO!*\n_Plataforma de Gestión Multi-Negocios_\n\nHola *{{firstName}} {{lastName}}*, nos complace informarte que tu negocio ha sido aprobado y activado en IDON. ✅\n\n🏢 *Negocio:* {{businessName}}\n🔗 *Identificador:* {{businessSlug}}\n\nYa puedes ingresar a tu panel de gestión con tu email y contraseña registrados.\n\n📞 *Soporte IDON:* wa.me/{{supportNumber}}\n\n_IDON — Sistema Integral de Gestión de Negocios_',
 ARRAY['firstName','lastName','businessName','businessSlug','supportNumber']),

('suscripcion',
 'Suscripción Activada',
 'Se envía cuando se crea o activa una suscripción para el negocio.',
 E'📦 *Suscripción Activada*\n\nHola *{{firstName}} {{lastName}}*, tu suscripción para *{{businessName}}* ha sido creada exitosamente. ✅\n\n💳 *Detalle de tu plan:*\n🏷️ Modalidad: {{plan}}\n💵 Monto: ${{amount}}\n📅 Próxima facturación: {{nextBillingDate}}\n\n¡Gracias por confiar en IDON!\n📞 *Soporte:* wa.me/{{supportNumber}}\n\n_IDON — Sistema Integral de Gestión de Negocios_',
 ARRAY['firstName','lastName','businessName','plan','amount','nextBillingDate','supportNumber']),

('recordatorio',
 'Recordatorio de Pago',
 'Se envía cuando quedan pocos días para el vencimiento de la suscripción.',
 E'⏰ *Recordatorio de Pago*\n\nHola *{{firstName}} {{lastName}}*, te recordamos que tu suscripción de *{{businessName}}* vence en *{{daysLeft}} día(s)*.\n\n💵 *Monto a pagar:* ${{amount}}\n📅 *Fecha límite:* {{dueDate}}\n\nRealiza tu pago a tiempo para evitar la suspensión del servicio.\n📞 *Soporte:* wa.me/{{supportNumber}}\n\n_IDON — Sistema Integral de Gestión de Negocios_',
 ARRAY['firstName','lastName','businessName','daysLeft','amount','dueDate','supportNumber']),

('pago_recibido',
 'Pago Recibido',
 'Se envía cuando el administrador IDON registra un pago como recibido.',
 E'✅ *Pago Recibido*\n\nHola *{{firstName}} {{lastName}}*, hemos registrado tu pago para *{{businessName}}*. ¡Gracias!\n\n🧾 *Comprobante:* {{invoiceNumber}}\n💵 *Monto pagado:* ${{amount}}\n📅 *Fecha de pago:* {{paymentDate}}\n📅 *Próxima facturación:* {{nextBillingDate}}\n\n📞 *Soporte:* wa.me/{{supportNumber}}\n\n_IDON — Sistema Integral de Gestión de Negocios_',
 ARRAY['firstName','lastName','businessName','invoiceNumber','amount','paymentDate','nextBillingDate','supportNumber'])

ON CONFLICT (type) DO NOTHING;
