-- Seed: features completas por módulo
-- Requiere que seed-modules.sql ya haya corrido

-- ══════════════════════════════════════════════════════
-- CORE
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'core.dashboard',      'Dashboard principal',          'Panel de resumen del negocio',                    id, FALSE FROM public.modules WHERE code='core' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'core.users',          'Gestión de usuarios',          'Crear y administrar usuarios del negocio',         id, FALSE FROM public.modules WHERE code='core' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'core.roles',          'Roles y permisos',             'Configurar roles y permisos por usuario',          id, FALSE FROM public.modules WHERE code='core' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'core.settings',       'Configuración general',        'Ajustes del negocio, moneda, zona horaria',        id, FALSE FROM public.modules WHERE code='core' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'core.audit_log',      'Registro de auditoría',        'Historial de todas las acciones del sistema',      id, TRUE  FROM public.modules WHERE code='core' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- POS
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'pos.sales',            'Ventas en caja',               'Registrar ventas y cobros en caja',                id, FALSE FROM public.modules WHERE code='pos' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'pos.discounts',        'Descuentos y promociones',     'Aplicar descuentos manuales y cupones',            id, FALSE FROM public.modules WHERE code='pos' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'pos.cash_register',    'Apertura/cierre de caja',      'Control de arqueo y cierre de turno',              id, FALSE FROM public.modules WHERE code='pos' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'pos.receipt_print',    'Impresión de recibos',         'Imprimir tickets y facturas en caja',              id, FALSE FROM public.modules WHERE code='pos' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'pos.returns',          'Devoluciones y cambios',       'Gestionar devoluciones y cambios de productos',    id, FALSE FROM public.modules WHERE code='pos' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'pos.quotes',           'Cotizaciones',                 'Generar cotizaciones para clientes',               id, FALSE FROM public.modules WHERE code='pos' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- INVENTORY
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'inventory.adjustments',    'Ajustes de inventario',         'Registrar pérdidas, mermas y ajustes manuales',   id, FALSE FROM public.modules WHERE code='inventory' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'inventory.categories',     'Categorías',                    'Organizar productos por categoría',               id, FALSE FROM public.modules WHERE code='inventory' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'inventory.products',       'Gestión de productos',          'Crear y editar catálogo de productos',             id, FALSE FROM public.modules WHERE code='inventory' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'inventory.physical',       'Inventario físico',             'Conteo físico y conciliación de inventario',      id, FALSE FROM public.modules WHERE code='inventory' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'inventory.suppliers',      'Proveedores',                   'Gestionar proveedores y compras de inventario',   id, TRUE  FROM public.modules WHERE code='inventory' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'inventory.recipes',        'Recetas e ingredientes',        'Gestionar recetas con ingredientes y costos',     id, TRUE  FROM public.modules WHERE code='inventory' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- REPORTS
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reports.sales',         'Reporte de ventas',            'Ventas por día, semana y mes',                    id, FALSE FROM public.modules WHERE code='reports' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reports.products',      'Productos más vendidos',       'Ranking y análisis de productos por ventas',       id, FALSE FROM public.modules WHERE code='reports' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reports.cashiers',      'Reporte por cajero',           'Ventas y rendimiento por usuario',                id, FALSE FROM public.modules WHERE code='reports' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reports.inventory',     'Reporte de inventario',        'Stock, rotación y valorización de inventario',    id, FALSE FROM public.modules WHERE code='reports' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reports.advanced',      'Análisis avanzado',           'Gráficas, tendencias y predicciones de ventas',   id, TRUE  FROM public.modules WHERE code='reports' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reports.customers',     'Reporte de clientes',          'Análisis de comportamiento y frecuencia',          id, TRUE  FROM public.modules WHERE code='reports' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reports.profit',        'Reporte de ganancias',         'Margen de ganancia por producto y categoría',     id, FALSE FROM public.modules WHERE code='reports' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reports.shifts',        'Reporte de turnos',            'Resumen de ventas por turno de trabajo',           id, FALSE FROM public.modules WHERE code='reports' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- PAYMENTS
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'payments.history',      'Historial de pagos',           'Consultar y filtrar historial de transacciones',   id, FALSE FROM public.modules WHERE code='payments' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- ACCOUNTING
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'accounting.expenses',    'Control de gastos',            'Registrar y categorizar gastos del negocio',       id, FALSE FROM public.modules WHERE code='accounting' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'accounting.tax',         'Gestión de impuestos',         'Calcular y reportar IVA y otros impuestos',        id, FALSE FROM public.modules WHERE code='accounting' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'accounting.balance',     'Balance y P&G',                'Estado de resultados y balance general',           id, TRUE  FROM public.modules WHERE code='accounting' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'accounting.sri',         'Integración SRI',              'Reportes y envío automático al SRI Ecuador',       id, TRUE  FROM public.modules WHERE code='accounting' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'accounting.payable',     'Cuentas por pagar',            'Gestión de deudas y pagos a proveedores',         id, FALSE FROM public.modules WHERE code='accounting' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'accounting.receivable',  'Cuentas por cobrar',           'Seguimiento de cobros pendientes a clientes',      id, FALSE FROM public.modules WHERE code='accounting' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'accounting.close',       'Cierre contable',              'Proceso de cierre mensual y anual',               id, TRUE  FROM public.modules WHERE code='accounting' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- ORDERS
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'orders.create',          'Crear órdenes',                'Registrar nuevos pedidos de clientes',            id, FALSE FROM public.modules WHERE code='orders' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'orders.tables',          'Gestión de mesas',             'Asignar pedidos a mesas del local',               id, FALSE FROM public.modules WHERE code='orders' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'orders.status',          'Seguimiento de estado',        'Actualizar y rastrear estado del pedido',         id, FALSE FROM public.modules WHERE code='orders' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'orders.modifiers',       'Modificadores de producto',    'Personalizar productos dentro del pedido',        id, TRUE  FROM public.modules WHERE code='orders' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'orders.qr',              'Órdenes por QR',               'Clientes hacen pedidos escaneando QR de mesa',    id, TRUE  FROM public.modules WHERE code='orders' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'orders.history',         'Historial de órdenes',         'Consultar y filtrar órdenes anteriores',           id, FALSE FROM public.modules WHERE code='orders' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'orders.scheduled',       'Órdenes programadas',          'Programar pedidos para fecha y hora futura',       id, TRUE  FROM public.modules WHERE code='orders' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- KITCHEN
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'kitchen.kds',            'Pantalla KDS',                 'Pantalla de cocina con pedidos en tiempo real',   id, FALSE FROM public.modules WHERE code='kitchen' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'kitchen.times',          'Tiempos de preparación',       'Control y estadísticas de tiempo por pedido',     id, FALSE FROM public.modules WHERE code='kitchen' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'kitchen.priority',       'Prioridad de pedidos',         'Marcar y gestionar pedidos urgentes',             id, FALSE FROM public.modules WHERE code='kitchen' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'kitchen.alerts',         'Alertas de demora',            'Notificaciones cuando un pedido se demora',       id, FALSE FROM public.modules WHERE code='kitchen' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'kitchen.history',        'Historial de producción',      'Registro de todos los pedidos producidos',        id, FALSE FROM public.modules WHERE code='kitchen' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'kitchen.stations',       'Gestión de estaciones',        'Dividir cocina en estaciones especializadas',     id, TRUE  FROM public.modules WHERE code='kitchen' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'kitchen.recipes',        'Recetas en pantalla',          'Mostrar receta del plato al cocinero',            id, TRUE  FROM public.modules WHERE code='kitchen' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- DELIVERY
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'delivery.orders',        'Pedidos a domicilio',          'Recibir y gestionar pedidos de entrega',           id, FALSE FROM public.modules WHERE code='delivery' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'delivery.drivers',       'Gestión de repartidores',      'Asignar pedidos y gestionar repartidores',        id, FALSE FROM public.modules WHERE code='delivery' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'delivery.zones',         'Zonas de cobertura',           'Definir zonas y precios de entrega',              id, FALSE FROM public.modules WHERE code='delivery' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'delivery.tracking',      'Rastreo en tiempo real',       'Seguimiento GPS de entregas en curso',             id, TRUE  FROM public.modules WHERE code='delivery' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'delivery.notifications', 'Notificaciones al cliente',    'SMS o WhatsApp del estado de la entrega',         id, TRUE  FROM public.modules WHERE code='delivery' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'delivery.history',       'Historial de entregas',        'Registro y consulta de entregas anteriores',       id, FALSE FROM public.modules WHERE code='delivery' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'delivery.rates',         'Tarifas por zona',             'Configurar precios de envío por zona',            id, FALSE FROM public.modules WHERE code='delivery' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'delivery.integrations',  'Integración apps externas',    'Conectar con Rappi, Uber Eats, PedidosYa',        id, TRUE  FROM public.modules WHERE code='delivery' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- TABLES
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tables.map',             'Mapa de mesas',                'Vista gráfica del plano de mesas del local',      id, FALSE FROM public.modules WHERE code='tables' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tables.status',          'Estado de mesas',              'Ver disponibilidad de mesas en tiempo real',       id, FALSE FROM public.modules WHERE code='tables' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tables.waiter',          'Asignación de mesero',         'Asignar mesero responsable por mesa',             id, FALSE FROM public.modules WHERE code='tables' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tables.merge',           'Fusión de mesas',              'Unir mesas para grupos grandes',                  id, FALSE FROM public.modules WHERE code='tables' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tables.timer',           'Tiempo en mesa',               'Controlar tiempo de ocupación por mesa',           id, FALSE FROM public.modules WHERE code='tables' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tables.rotation',        'Rotación de mesas',            'Análisis y optimización de rotación de mesas',    id, TRUE  FROM public.modules WHERE code='tables' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- RESERVATIONS
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reservations.online',    'Reservas en línea',            'Portal web para que clientes hagan reservas',     id, FALSE FROM public.modules WHERE code='reservations' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reservations.calendar',  'Calendario de reservas',       'Vista de calendario con todas las reservas',       id, FALSE FROM public.modules WHERE code='reservations' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reservations.email',     'Confirmación por email',       'Enviar confirmación automática por correo',        id, FALSE FROM public.modules WHERE code='reservations' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reservations.waitlist',  'Lista de espera',              'Gestionar lista de espera para mesas llenas',     id, FALSE FROM public.modules WHERE code='reservations' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reservations.reminders', 'Recordatorios automáticos',    'SMS o email de recordatorio antes de la reserva',  id, TRUE  FROM public.modules WHERE code='reservations' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reservations.recurring', 'Reservas recurrentes',         'Configurar reservas que se repiten periódicamente',id, TRUE  FROM public.modules WHERE code='reservations' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'reservations.deposit',   'Depósito de reserva',          'Cobrar anticipo al momento de la reserva',        id, TRUE  FROM public.modules WHERE code='reservations' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- LOYALTY
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'loyalty.points',         'Puntos por compra',            'Acumular puntos en cada compra realizada',        id, FALSE FROM public.modules WHERE code='loyalty' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'loyalty.redeem',         'Canje de puntos',              'Canjear puntos acumulados por descuentos',        id, FALSE FROM public.modules WHERE code='loyalty' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'loyalty.membership',     'Niveles de membresía',         'Bronce, plata, oro según consumo del cliente',    id, TRUE  FROM public.modules WHERE code='loyalty' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'loyalty.coupons',        'Cupones y promociones',        'Crear y distribuir cupones de descuento',         id, FALSE FROM public.modules WHERE code='loyalty' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'loyalty.card',           'Tarjeta de fidelización',      'Tarjeta física o digital de cliente frecuente',   id, FALSE FROM public.modules WHERE code='loyalty' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'loyalty.cashback',       'Cashback',                     'Devolver porcentaje del gasto al cliente',        id, TRUE  FROM public.modules WHERE code='loyalty' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'loyalty.referrals',      'Referidos',                    'Programa de referidos con recompensas',           id, TRUE  FROM public.modules WHERE code='loyalty' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- SUPPLIERS
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'suppliers.manage',       'Gestión de proveedores',       'Crear y administrar base de proveedores',          id, FALSE FROM public.modules WHERE code='suppliers' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'suppliers.orders',       'Órdenes de compra',            'Generar y enviar órdenes de compra',              id, FALSE FROM public.modules WHERE code='suppliers' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'suppliers.receiving',    'Recepción de mercadería',      'Registrar entradas de productos al inventario',    id, FALSE FROM public.modules WHERE code='suppliers' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'suppliers.evaluation',   'Evaluación de proveedores',    'Calificar y comparar proveedores',                id, TRUE  FROM public.modules WHERE code='suppliers' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'suppliers.prices',       'Precios por proveedor',        'Registrar precios de cada proveedor por producto', id, FALSE FROM public.modules WHERE code='suppliers' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- PURCHASES
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'purchases.orders',       'Órdenes de compra',            'Crear y gestionar órdenes de compra',             id, FALSE FROM public.modules WHERE code='purchases' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'purchases.approval',     'Aprobación de compras',        'Flujo de aprobación para compras mayores',        id, TRUE  FROM public.modules WHERE code='purchases' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'purchases.history',      'Historial de compras',         'Registro completo de todas las compras',          id, FALSE FROM public.modules WHERE code='purchases' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'purchases.categories',   'Gastos por categoría',         'Clasificar compras por categoría de gasto',       id, FALSE FROM public.modules WHERE code='purchases' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'purchases.budget',       'Presupuesto de compras',       'Definir y controlar presupuesto de compras',       id, TRUE  FROM public.modules WHERE code='purchases' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'purchases.returns',      'Devoluciones a proveedor',     'Gestionar devoluciones de productos al proveedor', id, FALSE FROM public.modules WHERE code='purchases' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- APPOINTMENTS
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'appointments.agenda',    'Agenda de citas',              'Calendario de citas del negocio',                 id, FALSE FROM public.modules WHERE code='appointments' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'appointments.online',    'Citas en línea',               'Portal para que clientes agenden en línea',        id, FALSE FROM public.modules WHERE code='appointments' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'appointments.reminders', 'Recordatorios automáticos',    'Recordatorio por email o WhatsApp al cliente',     id, FALSE FROM public.modules WHERE code='appointments' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'appointments.services',  'Gestión de servicios',         'Definir servicios con duración y precio',          id, FALSE FROM public.modules WHERE code='appointments' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'appointments.history',   'Historial de clientes',        'Ver historial de citas y servicios por cliente',   id, FALSE FROM public.modules WHERE code='appointments' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'appointments.recurring', 'Citas recurrentes',            'Programar citas que se repiten automáticamente',   id, TRUE  FROM public.modules WHERE code='appointments' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'appointments.block',     'Bloqueo de horarios',          'Bloquear horarios no disponibles',                id, FALSE FROM public.modules WHERE code='appointments' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'appointments.prepay',    'Pago anticipado de cita',      'Cobrar anticipo al momento de agendar',           id, TRUE  FROM public.modules WHERE code='appointments' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- EMPLOYEES
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'employees.payroll',      'Nómina básica',                'Cálculo básico de nómina y pagos a empleados',    id, TRUE  FROM public.modules WHERE code='employees' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'employees.manage',       'Gestión de Colaboradores',     'Crear y administrar perfil de empleados',          id, FALSE FROM public.modules WHERE code='employees' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'employees.schedules',    'Horarios y turnos',            'Crear y gestionar horarios de trabajo',            id, FALSE FROM public.modules WHERE code='employees' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'employees.attendance',   'Control de asistencia',        'Registro de entrada y salida de empleados',        id, FALSE FROM public.modules WHERE code='employees' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'employees.leaves',       'Permisos y vacaciones',        'Solicitud y aprobación de permisos',              id, TRUE  FROM public.modules WHERE code='employees' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'employees.performance',  'Evaluación de desempeño',      'Métricas y evaluación de rendimiento',            id, TRUE  FROM public.modules WHERE code='employees' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'employees.documents',    'Documentos del Colaborador',      'Almacenar contratos y documentos del personal',    id, FALSE FROM public.modules WHERE code='employees' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- CRM
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'crm.customers',          'Gestión de clientes',          'Registro completo de clientes del negocio',        id, FALSE FROM public.modules WHERE code='crm' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'crm.history',            'Historial de compras',         'Ver todas las compras de cada cliente',            id, FALSE FROM public.modules WHERE code='crm' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'crm.segments',           'Segmentación de clientes',     'Agrupar clientes por comportamiento o perfil',     id, TRUE  FROM public.modules WHERE code='crm' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'crm.email',              'Campañas de email',            'Enviar campañas de email marketing',              id, TRUE  FROM public.modules WHERE code='crm' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'crm.whatsapp',           'WhatsApp marketing',           'Enviar mensajes masivos por WhatsApp',            id, TRUE  FROM public.modules WHERE code='crm' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'crm.analytics',          'Análisis de comportamiento',   'Patrones de compra y preferencias del cliente',    id, TRUE  FROM public.modules WHERE code='crm' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- ROUTES
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'routes.planning',        'Planificación de rutas',       'Crear rutas de entrega para repartidores',         id, FALSE FROM public.modules WHERE code='routes' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'routes.optimization',    'Optimización de rutas',        'Calcular la ruta más eficiente automáticamente',   id, TRUE  FROM public.modules WHERE code='routes' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'routes.zones',           'Asignación de zonas',          'Definir zonas por repartidor',                    id, FALSE FROM public.modules WHERE code='routes' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'routes.history',         'Historial de rutas',           'Registro de rutas completadas',                   id, FALSE FROM public.modules WHERE code='routes' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'routes.cost',            'Costo por ruta',               'Calcular costo operativo de cada ruta',           id, FALSE FROM public.modules WHERE code='routes' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'routes.map',             'Mapa en tiempo real',          'Ver ubicación de repartidores en mapa',           id, TRUE  FROM public.modules WHERE code='routes' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- TRACKING
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tracking.gps',           'Rastreo GPS en tiempo real',   'Ubicación exacta del repartidor en todo momento', id, FALSE FROM public.modules WHERE code='tracking' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tracking.history',       'Historial de ubicaciones',     'Ruta recorrida por el repartidor',                id, FALSE FROM public.modules WHERE code='tracking' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tracking.alerts',        'Alertas de ruta',              'Notificación si el repartidor sale de la ruta',   id, FALSE FROM public.modules WHERE code='tracking' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tracking.live_status',   'Estado del pedido en vivo',    'Cliente ve el estado de su pedido en tiempo real',id, FALSE FROM public.modules WHERE code='tracking' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tracking.notify',        'Notificación al cliente',      'Alerta automática cuando el pedido está cerca',    id, TRUE  FROM public.modules WHERE code='tracking' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'tracking.eta',           'Estimado de llegada',          'Calcular tiempo estimado de entrega',             id, TRUE  FROM public.modules WHERE code='tracking' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- QUEUE
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'queue.manage',           'Gestión de turnos',            'Asignar y llamar turnos de clientes',             id, FALSE FROM public.modules WHERE code='queue' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'queue.screen',           'Pantalla de llamado',          'Pantalla que muestra el turno llamado',           id, FALSE FROM public.modules WHERE code='queue' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'queue.digital',          'Turno digital desde celular',  'Cliente saca turno desde su celular',             id, TRUE  FROM public.modules WHERE code='queue' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'queue.wait_time',        'Estimado de espera',           'Mostrar tiempo estimado de espera al cliente',     id, FALSE FROM public.modules WHERE code='queue' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'queue.priority',         'Prioridad de turno',           'Dar prioridad a clientes especiales o VIP',       id, TRUE  FROM public.modules WHERE code='queue' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'queue.stats',            'Estadísticas de espera',       'Análisis de tiempos de espera y atención',        id, FALSE FROM public.modules WHERE code='queue' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- ECOMMERCE
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'ecommerce.catalog',      'Catálogo en línea',            'Mostrar productos en tienda virtual',             id, FALSE FROM public.modules WHERE code='ecommerce' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'ecommerce.cart',         'Carrito de compras',           'Carrito de compras para clientes',                id, FALSE FROM public.modules WHERE code='ecommerce' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'ecommerce.payments',     'Pasarela de pago',             'Pago en línea seguro integrado',                  id, FALSE FROM public.modules WHERE code='ecommerce' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'ecommerce.orders',       'Gestión de pedidos online',    'Administrar pedidos recibidos por la tienda',     id, FALSE FROM public.modules WHERE code='ecommerce' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'ecommerce.coupons',      'Cupones online',               'Crear cupones de descuento para tienda online',   id, FALSE FROM public.modules WHERE code='ecommerce' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'ecommerce.seo',          'SEO básico',                   'Optimización básica para buscadores',             id, FALSE FROM public.modules WHERE code='ecommerce' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'ecommerce.social',       'Integración redes sociales',   'Conectar tienda con Instagram y Facebook',        id, TRUE  FROM public.modules WHERE code='ecommerce' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'ecommerce.multi',        'Múltiples tiendas',            'Gestionar varias tiendas desde un solo panel',    id, TRUE  FROM public.modules WHERE code='ecommerce' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'ecommerce.abandoned',    'Carritos abandonados',         'Recuperar ventas de carritos no completados',     id, TRUE  FROM public.modules WHERE code='ecommerce' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'notifications.push',     'Notificaciones push',          'Alertas push en app móvil o navegador',           id, FALSE FROM public.modules WHERE code='notifications' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'notifications.whatsapp', 'Notificaciones por WhatsApp',  'Alertas automáticas por WhatsApp',                id, TRUE  FROM public.modules WHERE code='notifications' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'notifications.scheduled','Notificaciones programadas',   'Programar alertas para fecha y hora específica',   id, TRUE  FROM public.modules WHERE code='notifications' ON CONFLICT (code) DO NOTHING;

-- ══════════════════════════════════════════════════════
-- EINVOICING — Facturación Electrónica SRI Ecuador
-- ══════════════════════════════════════════════════════
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'einvoicing.status',      'Consulta estado comprobante',  'Verificar estado de autorización en el SRI',       id, FALSE FROM public.modules WHERE code='einvoicing' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'einvoicing.void',        'Anulación de comprobantes',    'Anular comprobantes electrónicos ante el SRI',     id, FALSE FROM public.modules WHERE code='einvoicing' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'einvoicing.credit_notes','Notas de crédito',             'Emitir notas de crédito electrónicas',            id, FALSE FROM public.modules WHERE code='einvoicing' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'einvoicing.debit_notes', 'Notas de débito',              'Emitir notas de débito electrónicas',             id, FALSE FROM public.modules WHERE code='einvoicing' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'einvoicing.retentions',  'Retenciones',                  'Emitir comprobantes de retención',                id, FALSE FROM public.modules WHERE code='einvoicing' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'einvoicing.remissions',  'Guías de remisión',            'Emitir guías de remisión para traslado de bienes',id, FALSE FROM public.modules WHERE code='einvoicing' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'einvoicing.whatsapp',    'Integración de Whatsapp',      'Inregración de Whatsapp para comprobantes electrónicos',        id, FALSE FROM public.modules WHERE code='einvoicing' ON CONFLICT (code) DO NOTHING;
INSERT INTO public.features (code, name, description, module_id, is_premium) SELECT 'einvoicing.reports',     'Reportes SRI',                 'Reportes de comprobantes por período fiscal',      id, TRUE  FROM public.modules WHERE code='einvoicing' ON CONFLICT (code) DO NOTHING;
