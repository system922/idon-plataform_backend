import express from 'express';
import cors from 'cors';
import env from './config/env.js';
import logger from './utils/logger.js';

// ─── Routes ──────────────────────────────────────────────────────────────────
import auditLogRoutes        from './routes/auditLogRoutes.js';
import securityRoutes        from './routes/security.js';
import usersRoutes           from './routes/users.js';
import cashRegisterRoutes    from './routes/cashRegister.js';
import businessStatusRoutes  from './routes/businessStatus.js';
import businessTypeRoutes_r  from './routes/businessTypeRoutes.js';
import authRoutes            from './routes/auth.js';
import registerRoutes        from './routes/register.js';
import adminRoutes           from './routes/admin.js';
import catalogRoutes         from './routes/catalog.js';
import navigationRoutes      from './routes/navigation.js';
import notificationsAdminRoutes from './routes/notificationsAdmin.js';
import subscriptionRoutes    from './routes/subscription.js';
import moduleRoutes          from './routes/moduleRoutes.js';
import featureRoutes         from './routes/featureRoutes.js';
import businessTypeRoutes    from './routes/businessTypeRoutes.js';
import roleRoutes            from './routes/roleRoutes.js';
import fiscalConfigRoutes    from './routes/fiscalConfigRoutes.js';
import paymentsAdminRoutes   from './routes/paymentsAdmin.js';
import billingHistoryRoutes  from './routes/billingHistoryRoutes.js';
import businessOwnersRoutes  from './routes/businessOwners.js';
import CustomersRoutes       from './routes/customers.js';
import productosRoutes       from './routes/productos.js';
import categoriesRoutes      from './routes/categoriesRoutes.js';
import ordenesRoutes         from './routes/ordenes.js';
import posSettingsRoutes     from './routes/posSettings.js';
import reportsRoutes         from './routes/reportsRoutes.js';
import salesRouter           from './routes/salesRouter.js';
import purchasesRouter       from './routes/purchasesRouter.js';
import hoursRouter           from './routes/hoursRouter.js';
import printRoutes           from './routes/print.js';
import einvoicingRoutes      from './routes/einvoicing.js';
import whatsappRoutes        from './routes/whatsapp.js';
import businessRoutes        from './routes/business.js';
import expensesRoutes        from './routes/expenses.js';
import graphRoutes           from './routes/graphRoutes.js';
import inventoryRoutes       from './routes/inventoryRoutes.js';
import suppliersRoutes       from './routes/suppliersRoutes.js';
import recipesRoutes         from './routes/recipesRoutes.js';
import employeesRoutes       from './routes/employeesRoutes.js';
import attendanceRoutes      from './routes/attendanceRoutes.js';
import payrollRoutes         from './routes/payrollRoutes.js';

// ─── Middleware ───────────────────────────────────────────────────────────────
import { authMiddleware, businessContextMiddleware, adminMiddleware } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

// ─── Core middleware ──────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: env.corsOrigin, credentials: true }));
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

// ─── Rutas autenticadas + contexto de negocio ─────────────────────────────────
app.use('/api/settings',            ...authBusiness, posSettingsRoutes);




app.use('/api/core/roles',          ...authBusiness, roleRoutes);
app.use('/api/core/users',          ...authBusiness, usersRoutes);
app.use('/api/pos/cash-register',   ...authBusiness, cashRegisterRoutes);
app.use('/api/navigation',          ...authBusiness, navigationRoutes);
app.use('/api/subscriptions',       ...authBusiness, subscriptionRoutes);
app.use('/api/customers',           ...authBusiness, CustomersRoutes);
app.use('/api/products',            ...authBusiness, productosRoutes);
app.use('/api/categories',          ...authBusiness, categoriesRoutes);
app.use('/api/expenses',            ...authBusiness, expensesRoutes);
app.use('/api/graphs',              ...authBusiness, graphRoutes);
app.use('/api/inventory',           ...authBusiness, inventoryRoutes);
app.use('/api/suppliers',           ...authBusiness, suppliersRoutes);
app.use('/api/recipes',             ...authBusiness, recipesRoutes);
app.use('/api/employees',           ...authBusiness, employeesRoutes);
app.use('/api/attendance',          ...authBusiness, attendanceRoutes);
app.use('/api/payroll',             ...authBusiness, payrollRoutes);
app.use('/api/ordenes',             ...authBusiness, ordenesRoutes);

app.use('/api/reports',             ...authBusiness, reportsRoutes);
app.use('/api/print',               ...authBusiness, printRoutes);
app.use('/api/einvoicing',          ...authBusiness, einvoicingRoutes);
app.use('/api/whatsapp',            ...authBusiness, whatsappRoutes);
app.use('/api/admin/whatsapp',      ...authAdmin,    whatsappRoutes);
app.use('/api/business',            ...authBusiness, businessRoutes);
app.use('/api/sales',               ...authBusiness, salesRouter);
app.use('/api/purchases',           ...authBusiness, purchasesRouter);
app.use('/api/hours',               ...authBusiness, hoursRouter);
app.use('/api/business-status',     ...auth,         businessStatusRoutes);

// ─── Rutas de admin ───────────────────────────────────────────────────────────
app.use('/api/admin',                         adminRoutes);
app.use('/api/admin/modules',        ...authAdmin, moduleRoutes);
app.use('/api/admin/features',       ...authAdmin, featureRoutes);
app.use('/api/admin/business-types', ...authAdmin, businessTypeRoutes);
app.use('/api/admin/roles',          ...authAdmin, roleRoutes);
app.use('/api/admin/fiscal-config',  ...authAdmin, fiscalConfigRoutes);
app.use('/api/admin/payments',       ...authAdmin, paymentsAdminRoutes);
app.use('/api/admin/billing-history',...authAdmin, billingHistoryRoutes);
app.use('/api/notifications-admin',  ...authAdmin, notificationsAdminRoutes);

// ─── Error handlers ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;