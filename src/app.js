import express from 'express';
import cors from 'cors';
import env from './config/env.js';
import logger from './utils/logger.js';

// ─── Routes ──────────────────────────────────────────────────────────────────
import fiscalRoutes          from './routes/fiscalRoutes.js';
import auditLogRoutes        from './routes/auditLogRoutes.js';
import securityRoutes        from './routes/security.js';
import usersRoutes           from './routes/users.js';
import cashRegisterRoutes    from './routes/cashRegister.js';
import businessStatusRoutes  from './routes/businessStatus.js';
import businessTypeRoutes_r  from './routes/businessTypeRoutes.js'; // alias para ruta pública
import authRoutes            from './routes/auth.js';
import registerRoutes        from './routes/register.js';

// ─── Admin routes (una por sección del sidebar) ───────────────────────────────
import adminDashboardRoutes  from './routes/admin/dashboard.js';
import adminRequestsRoutes   from './routes/admin/requests.js';
import adminClientsRoutes    from './routes/admin/clients.js';
import adminModulesRoutes    from './routes/admin/modules.js';
import adminFeaturesRoutes   from './routes/admin/features.js';
import adminPaymentsRoutes   from './routes/admin/payments.js';
import adminUsersRoutes      from './routes/admin/users.js';
import adminRolesRoutes      from './routes/admin/roles.js';
import adminSettingsRoutes   from './routes/admin/settings.js';
import adminAuditRoutes      from './routes/admin/audit.js';
import adminTemplatesRoutes      from './routes/admin/templates.js';
import adminEmailTemplatesRoutes from './routes/admin/emailTemplates.js';

import catalogRoutes         from './routes/catalog.js';
import navigationRoutes      from './routes/navigation.js';
import notificationsAdminRoutes from './routes/notificationsAdmin.js';
import subscriptionRoutes    from './routes/subscription.js';
import businessTypeRoutes    from './routes/businessTypeRoutes.js';
import roleRoutes            from './routes/roleRoutes.js';
import fiscalConfigRoutes    from './routes/fiscalConfigRoutes.js';
import businessOwnersRoutes  from './routes/businessOwners.js';
import CustomersRoutes       from './routes/customers.js';
import productosRoutes       from './routes/productos.js';
import categoriesRoutes      from './routes/categoriesRoutes.js';
import ordenesRoutes         from './routes/ordenes.js';
import retailRoutes          from './routes/retail.js';
import posSettingsRoutes     from './routes/posSettings.js';
import discountsRoutes      from './routes/discountsRoutes.js';
import reportsRoutes         from './routes/reportsRoutes.js';
import salesRouter           from './routes/salesRouter.js';
import purchasesRouter       from './routes/purchasesRouter.js';
import hoursRouter           from './routes/hoursRouter.js';
import printRoutes           from './routes/print.js';
import einvoicingRoutes      from './routes/einvoicing.js';
import businessRoutes        from './routes/business.js';
import expensesRoutes        from './routes/expenses.js';
import graphRoutes           from './routes/graphRoutes.js';
import inventoryRoutes       from './routes/inventoryRoutes.js';
import suppliersRoutes       from './routes/suppliersRoutes.js';
import recipesRoutes         from './routes/recipesRoutes.js';
import employeesRoutes       from './routes/employeesRoutes.js';
import attendanceRoutes      from './routes/attendanceRoutes.js';
import payrollRoutes         from './routes/payrollRoutes.js';
import expensesCategoriesRoutes from './routes/expensesCategoriesRoutes.js';
import crmRoutes             from './routes/crmRoutes.js';
import dashboardRouter        from './routes/dashboardRouter.js';
import accountingRoutes            from './routes/accountingRoutes.js';
import accountingReceivableRoutes  from './routes/accountingReceivable.js';
import accountingPayableRoutes     from './routes/accountingPayable.js';
import pushRoutes                 from './routes/pushRoutes.js';
import scheduledNotificationsRoutes from './routes/scheduledNotificationsRoutes.js';
import notificationsEmailRoutes   from './routes/notificationsEmailRoutes.js';

// ============================================================
// IMPORTAR RUTAS DE ODONTOLOGÍA - CONFIGURACIÓN
// ============================================================
import configuracionGeneralRoutes from './routes/odontologia/configuracionGeneralRoutes.js';
import especialistasRoutes from './routes/odontologia/especialistasRoutes.js';
import horariosTrabajoRoutes from './routes/odontologia/horariosTrabajoRoutes.js';
import gruposAgendasRoutes from './routes/odontologia/gruposAgendasRoutes.js';
import motivosConsultaRoutes from './routes/odontologia/motivosConsultaRoutes.js';
import agendasRoutes from './routes/odontologia/agendasRoutes.js';
import citasRoutes from './routes/odontologia/citasRoutes.js';
import pacientesRoutes from './routes/odontologia/pacientesRoutes.js';
import tratamientosRoutes from './routes/odontologia/tratamientosRoutes.js';
import plantillasRecetasRoutes from './routes/odontologia/plantillasRecetasRoutes.js';
import planesTratamientoRoutes from './routes/odontologia/planesTratamientoRoutes.js';
import citasRoutes from './routes/odontologia/citasRoutes.js';

// ─── Middleware ───────────────────────────────────────────────────────────────
import { authMiddleware, businessContextMiddleware, adminMiddleware } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

// ─── Core middleware ──────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (mobile apps, curl, Render health checks)
    if (!origin) return cb(null, true);
    if (env.corsOrigin.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-business-id', 'x-db-name'],
}));
app.options('*', cors());
app.use((req, res, next) => { logger.info(`${req.method} ${req.path}`); next(); });

// ─── Middleware groups ────────────────────────────────────────────────────────
const auth         = [authMiddleware];
const authBusiness = [authMiddleware, businessContextMiddleware];
const authAdmin    = [authMiddleware, adminMiddleware];

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

// ─── Rutas públicas ───────────────────────────────────────────────────────────
app.use('/api/auth',            authRoutes);
app.use('/api/register',        registerRoutes);
app.use('/api/catalog',         catalogRoutes);
app.use('/api/business-types',  businessTypeRoutes_r);
app.use('/api/security',        securityRoutes);
app.use('/api/audit-log',       auditLogRoutes);
app.use('/api/business-owners', businessOwnersRoutes);

// ─── Ruta de configureación fiscal ─────────────────────────────────────────────────
app.use('/api/fiscal', fiscalRoutes);


// ─── Rutas autenticadas + contexto de negocio ─────────────────────────────────
app.use('/api/settings',            ...authBusiness, posSettingsRoutes);
app.use('/api/core/roles',          ...authBusiness, roleRoutes);
app.use('/api/core/users',          ...authBusiness, usersRoutes);
app.use('/api/pos/cash-register',   ...authBusiness, cashRegisterRoutes);


app.use('/api/navigation',          ...authBusiness, navigationRoutes);
app.use('/api/subscriptions',       ...authBusiness, subscriptionRoutes);
app.use('/api/customers',           ...authBusiness, CustomersRoutes);
app.use('/api/products',            ...authBusiness, productosRoutes);
app.use('/api/productos',           ...authBusiness, productosRoutes);
app.use('/api/categories',          ...authBusiness, categoriesRoutes);

app.use('/api/graphs',              ...authBusiness, graphRoutes);
app.use('/api/inventory',           ...authBusiness, inventoryRoutes);
app.use('/api/suppliers',           ...authBusiness, suppliersRoutes);
app.use('/api/recipes',             ...authBusiness, recipesRoutes);
app.use('/api/employees',           ...authBusiness, employeesRoutes);
app.use('/api/attendance',          ...authBusiness, attendanceRoutes);
app.use('/api/payroll',             ...authBusiness, payrollRoutes);
app.use('/api/ordenes',             ...authBusiness, ordenesRoutes);
app.use('/api/retail',              ...authBusiness, retailRoutes);
app.use('/api/discounts',           ...authBusiness, discountsRoutes);
app.use('/api/crm',                 ...authBusiness, crmRoutes);
app.use('/api/dashboard',           ...authBusiness, dashboardRouter);
app.use('/api/accounting',            ...authBusiness, accountingRoutes);
app.use('/api/accounting-receivable', ...authBusiness, accountingReceivableRoutes);
app.use('/api/accounting-payable',    ...authBusiness, accountingPayableRoutes);
app.use('/api/notifications',         ...authBusiness, notificationsEmailRoutes);

app.use('/api/reports',             ...authBusiness, reportsRoutes);
app.use('/api/print',               ...authBusiness, printRoutes);
app.use('/api/einvoicing',          ...authBusiness, einvoicingRoutes);
app.use('/api/business',            ...authBusiness, businessRoutes);
app.use('/api/sales',               ...authBusiness, salesRouter);
app.use('/api/purchases',           ...authBusiness, purchasesRouter);
app.use('/api/expenses',            ...authBusiness, expensesRoutes);
app.use('/api/expense-categories', ...authBusiness, expensesCategoriesRoutes);
app.use('/api/hours',               ...authBusiness, hoursRouter);
app.use('/api/business-status',     ...auth,         businessStatusRoutes);


// ============================================================
// RUTAS DE ODONTOLOGÍA
// ============================================================
app.use('/api/odontologia/configuracion-general', ...authBusiness, configuracionGeneralRoutes);
app.use('/api/odontologia/especialistas', ...authBusiness, especialistasRoutes);
app.use('/api/odontologia/horarios-trabajo', ...authBusiness, horariosTrabajoRoutes);
app.use('/api/odontologia/grupos-agendas', ...authBusiness, gruposAgendasRoutes);
app.use('/api/odontologia/motivos-consulta', ...authBusiness, motivosConsultaRoutes);
app.use('/api/odontologia/agendas', ...authBusiness, agendasRoutes);
app.use('/api/odontologia/pacientes', ...authBusiness, pacientesRoutes);
app.use('/api/odontologia/citas', ...authBusiness, citasRoutes);
app.use('/api/odontologia/tratamientos', ...authBusiness, tratamientosRoutes);
app.use('/api/odontologia/plantillas-recetas', ...authBusiness, plantillasRecetasRoutes);
app.use('/api/odontologia/planes-tratamiento', ...authBusiness, planesTratamientoRoutes);

// ─── Rutas de admin (una por sección del sidebar) ─────────────────────────────
app.use('/api/admin', ...authAdmin, adminDashboardRoutes);  // General → Dashboard
app.use('/api/admin', ...authAdmin, adminRequestsRoutes);   // Negocios → Solicitudes
app.use('/api/admin', ...authAdmin, adminClientsRoutes);    // Negocios → Gestión de Clientes
app.use('/api/admin', ...authAdmin, adminModulesRoutes);    // Sistema  → Módulos
app.use('/api/admin', ...authAdmin, adminFeaturesRoutes);   // Sistema  → Funcionalidades
app.use('/api/admin', ...authAdmin, adminPaymentsRoutes);   // Comercial → Pagos
app.use('/api/admin', ...authAdmin, adminUsersRoutes);      // Usuarios → Gestión de Usuarios
app.use('/api/admin', ...authAdmin, adminRolesRoutes);      // Usuarios → Roles y Permisos
app.use('/api/admin', ...authAdmin, adminSettingsRoutes);   // Global   → Configuración
app.use('/api/admin', ...authAdmin, adminAuditRoutes);      // Global   → Auditoría
app.use('/api/admin', ...authAdmin, adminTemplatesRoutes);      // Sistema  → Plantillas de negocios
app.use('/api/admin', ...authAdmin, adminEmailTemplatesRoutes); // Comercial → Plantillas de Email
app.use('/api/admin/business-types',  ...authAdmin, businessTypeRoutes);  // Sistema → Tipos de Negocio
app.use('/api/admin/fiscal-config',   ...authAdmin, fiscalConfigRoutes);  // Global  → Config Fiscal
app.use('/api/notifications-admin',   ...authAdmin, notificationsAdminRoutes);

// Push + scheduled — must be AFTER admin routes so /api/admin/* isn't intercepted by businessContextMiddleware
app.use('/api',                       ...authBusiness, pushRoutes);
app.use('/api',                       ...authBusiness, scheduledNotificationsRoutes);

// ─── Error handlers ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;