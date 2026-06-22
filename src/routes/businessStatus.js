// BACKEND/src/routes/businessStatus.js
// Registrar en app.js:
//   import businessStatusRoutes from './routes/businessStatus.js';
//   app.use('/api/business-status', authMiddleware, businessStatusRoutes);

import express from 'express';
import { query } from '../config/database.js';

const router = express.Router();

// =====================================================
// Verificar si un negocio específico está suspendido
// GET /api/business-status/check/:businessId
// =====================================================
router.get('/check/:businessId', async (req, res, next) => {
  try {
    const { businessId } = req.params;
    
    const { rows } = await query(`
      SELECT s.status, s.suspended_at, b.is_active
      FROM public.subscriptions s
      JOIN public.businesses b ON s.business_id = b.id
      WHERE s.business_id = $1
      ORDER BY s.created_at DESC
      LIMIT 1
    `, [businessId]);

    if (rows.length === 0) {
      return res.json({
        ok: true,
        isSuspended: false,
        status: 'no_subscription',
        message: 'El negocio no tiene una suscripción activa'
      });
    }

    const isSuspended = rows[0].status === 'suspended' || !rows[0].is_active;

    res.json({
      ok: true,
      isSuspended: isSuspended,
      status: rows[0].status,
      suspendedAt: rows[0].suspended_at,
      isActive: rows[0].is_active
    });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// Verificar estado del negocio del usuario autenticado
// GET /api/business-status/my-status
// =====================================================
router.get('/my-status', async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, message: 'No autenticado' });
    }

    const { rows: bizRows } = await query(`
      SELECT
        b.id         AS business_id,
        b.name       AS business_name,
        b.slug,
        b.is_active,
        bt.name      AS business_type,
        s.status     AS subscription_status,
        s.suspended_at,
        s.next_billing_at,
        bu.role_id,
        r.code       AS role_code
      FROM public.business_users bu
      JOIN public.businesses b ON bu.business_id = b.id
      JOIN public.business_types bt ON b.business_type_id = bt.id
      LEFT JOIN public.subscriptions s ON s.business_id = b.id
      LEFT JOIN public.roles r ON bu.role_id = r.id
      WHERE bu.user_id = $1
      LIMIT 1
    `, [userId]);

    if (bizRows.length === 0) {
      // Buscar solicitud de registro
      const { rows: reqRows } = await query(`
        SELECT brr.status, brr.business_name, brr.rejection_reason, bt.name AS business_type
        FROM public.business_registration_requests brr
        LEFT JOIN public.business_types bt ON brr.business_type_id = bt.id
        WHERE brr.user_id = $1
        ORDER BY brr.requested_at DESC
        LIMIT 1
      `, [userId]);

      if (reqRows.length === 0) {
        return res.json({ ok: true, status: 'no_request' });
      }

      const req_ = reqRows[0];
      if (req_.status === 'rejected') {
        return res.json({
          ok: true,
          status: 'rejected',
          message: req_.rejection_reason || 'Tu solicitud fue rechazada.',
          business: { name: req_.business_name, type: req_.business_type },
        });
      }

      return res.json({
        ok: true,
        status: 'pending',
        business: { name: req_.business_name, type: req_.business_type },
      });
    }

    const biz = bizRows[0];

    // Verificar si está suspendido
    const isSuspended = !biz.is_active || biz.subscription_status === 'suspended';

    if (isSuspended) {
      return res.json({
        ok: true,
        status: 'suspended',
        isSuspended: true,
        message: 'Tu negocio está suspendido. Contacta al administrador.',
        business: {
          id: biz.business_id,
          name: biz.business_name,
          slug: biz.slug,
          type: biz.business_type,
        },
        subscription: {
          status: biz.subscription_status,
          suspendedAt: biz.suspended_at,
          nextBillingAt: biz.next_billing_at,
        }
      });
    }

    // Negocio activo
    return res.json({
      ok: true,
      status: 'active',
      isSuspended: false,
      business: {
        id: biz.business_id,
        name: biz.business_name,
        slug: biz.slug,
        type: biz.business_type,
        isActive: biz.is_active,
        role: biz.role_code,
      },
      subscription: {
        status: biz.subscription_status,
        nextBillingAt: biz.next_billing_at,
      }
    });

  } catch (error) {
    next(error);
  }
});

// =====================================================
// ENDPOINT ORIGINAL: GET /api/business-status
// =====================================================
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, message: 'No autenticado' });
    }

    const { rows: bizRows } = await query(`
      SELECT
        b.id         AS business_id,
        b.name       AS business_name,
        b.slug,
        b.is_active,
        bt.name      AS business_type,
        s.status     AS subscription_status,
        s.next_billing_at,
        bu.role_id,
        r.code       AS role_code
      FROM public.business_users bu
      JOIN public.businesses b  ON bu.business_id = b.id
      JOIN public.business_types bt ON b.business_type_id = bt.id
      LEFT JOIN public.subscriptions s ON s.business_id = b.id
      LEFT JOIN public.roles r ON bu.role_id = r.id
      WHERE bu.user_id = $1
      LIMIT 1
    `, [userId]);

    if (bizRows.length > 0) {
      const biz = bizRows[0];

      if (!biz.is_active || biz.subscription_status === 'suspended') {
        return res.json({
          ok: true,
          status: 'suspended',
          message: 'Tu negocio está suspendido por falta de pago. Contacta al administrador.',
          business: {
            id:    biz.business_id,
            name:  biz.business_name,
            slug:  biz.slug,
            type:  biz.business_type,
          },
        });
      }

      return res.json({
        ok: true,
        status: 'approved',
        business: {
          id:                  biz.business_id,
          name:                biz.business_name,
          slug:                biz.slug,
          type:                biz.business_type,
          subscription_status: biz.subscription_status,
          next_billing_at:     biz.next_billing_at,
          role:                biz.role_code,
        },
      });
    }

    const { rows: reqRows } = await query(`
      SELECT brr.status, brr.business_name, brr.rejection_reason, bt.name AS business_type
      FROM public.business_registration_requests brr
      LEFT JOIN public.business_types bt ON brr.business_type_id = bt.id
      WHERE brr.user_id = $1
      ORDER BY brr.requested_at DESC
      LIMIT 1
    `, [userId]);

    if (reqRows.length === 0) {
      return res.json({ ok: true, status: 'no_request' });
    }

    const req_ = reqRows[0];

    if (req_.status === 'rejected') {
      return res.json({
        ok: true,
        status: 'rejected',
        message: req_.rejection_reason || 'Tu solicitud fue rechazada.',
        business: { name: req_.business_name, type: req_.business_type },
      });
    }

    return res.json({
      ok: true,
      status: 'pending',
      business: { name: req_.business_name, type: req_.business_type },
    });

  } catch (error) {
    next(error);
  }
});

// =====================================================
// ENDPOINT ORIGINAL: GET /api/business-status/my-businesses
// =====================================================
router.get('/my-businesses', async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ ok: false, message: 'No autenticado' });

    if (req.user?.userType === 'schema_employee') {
      const { businessId, schemaName } = req.user;
      const { rows } = await query(`
        SELECT b.id, b.name, b.slug,
               b.schema_name AS "schemaName",
               b.is_active   AS "isActive",
               bt.name       AS type,
               s.status      AS subscription_status,
               s.next_billing_at
        FROM public.businesses b
        JOIN public.business_types bt  ON b.business_type_id = bt.id
        LEFT JOIN public.subscriptions s ON s.business_id = b.id
        WHERE b.id = $1
      `, [businessId]);
      return res.json({ ok: true, businesses: rows });
    }

    const { rows } = await query(`
      SELECT
        b.id,
        b.name,
        b.slug,
        b.schema_name        AS "schemaName",
        b.is_active          AS "isActive",
        bt.name              AS type,
        s.status             AS subscription_status,
        s.next_billing_at,
        r.code               AS role
      FROM public.business_users bu
      JOIN public.businesses b       ON bu.business_id = b.id
      JOIN public.business_types bt  ON b.business_type_id = bt.id
      LEFT JOIN public.subscriptions s ON s.business_id = b.id
      LEFT JOIN public.roles r         ON bu.role_id = r.id
      WHERE bu.user_id = $1
      ORDER BY b.name ASC
    `, [userId]);

    res.json({ ok: true, businesses: rows });
  } catch (e) {
    next(e);
  }
});

// =====================================================
// ENDPOINT ORIGINAL: GET /api/business-status/navigation
// =====================================================
router.get('/navigation', async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ ok: false, message: 'No autenticado' });

    const MODULE_DEFAULTS = {
      core: '/app/core', pos: '/app/pos', inventory: '/app/inventory',
      reports: '/app/reports', payments: '/app/payments', accounting: '/app/accounting',
      orders: '/app/orders', kitchen: '/app/kitchen', delivery: '/app/delivery',
      tables: '/app/tables', reservations: '/app/reservations', loyalty: '/app/loyalty',
      suppliers: '/app/suppliers', purchases: '/app/purchases', appointments: '/app/appointments',
      employees: '/app/employees', crm: '/app/crm', routes: '/app/routes',
      tracking: '/app/tracking', queue: '/app/queue', ecommerce: '/app/ecommerce',
      notifications: '/app/notifications', einvoicing: '/app/einvoicing',
    };

    const buildModulePages = (mod, featureRows) => {
      if (featureRows.length > 0) {
        const basePath = MODULE_DEFAULTS[mod.code] || `/app/${mod.code}`;
        return [
          { id: mod.id + '-main', code: mod.code, name: 'General', path: basePath, icon: mod.icon, isMain: true },
          ...featureRows.map(f => ({ id: f.id, code: f.code, name: f.name, path: `${basePath}/${f.code}`, icon: null, isFeature: true })),
        ];
      }
      if (MODULE_DEFAULTS[mod.code]) {
        return [{ id: mod.id + '-default', code: mod.code, name: mod.name, path: MODULE_DEFAULTS[mod.code], icon: mod.icon }];
      }
      return [];
    };

    // ── Empleados de esquema (nivel 3) ──────────────────────────────────────
    if (req.user?.userType === 'schema_employee') {
      const { businessId, schemaName } = req.user;

      let roleId = null, roleName = 'employee', rolePermissions = null;
      try {
        const { rows: tenantUser } = await query(`
          SELECT u.role_id, r.name AS role_name, r.permissions
          FROM "${schemaName}".users u
          LEFT JOIN "${schemaName}".roles r ON u.role_id = r.id
          WHERE u.id = $1
          LIMIT 1
        `, [userId]);
        if (tenantUser.length > 0) {
          roleId   = tenantUser[0].role_id;
          roleName = tenantUser[0].role_name || 'employee';
          rolePermissions = tenantUser[0].permissions;
        }
      } catch (e) {}

      let permsByModule = null;
      if (Array.isArray(rolePermissions) && rolePermissions.length > 0) {
        permsByModule = {};
        for (const p of rolePermissions) {
          permsByModule[p.modulo] = new Set(Array.isArray(p.features) ? p.features : []);
        }
      } else if (typeof rolePermissions === 'string') {
        try {
          const parsed = JSON.parse(rolePermissions);
          if (Array.isArray(parsed) && parsed.length > 0) {
            permsByModule = {};
            for (const p of parsed) {
              permsByModule[p.modulo] = new Set(Array.isArray(p.features) ? p.features : []);
            }
          }
        } catch {}
      }

      const { rows: allModules } = await query(`
        SELECT m.id, m.code, m.name, m.icon, m.sort_order
        FROM public.business_modules bm
        JOIN public.modules m ON bm.module_id = m.id
        WHERE bm.business_id = $1 AND bm.is_active = true
        ORDER BY m.sort_order ASC
      `, [businessId]);

      const allowedModules = permsByModule
        ? allModules.filter(m => permsByModule.hasOwnProperty(m.id))
        : allModules;

      const menuModules = [];
      for (const mod of allowedModules) {
        const { rows: bizFeatures } = await query(`
          SELECT f.id, f.code, f.name
          FROM public.business_features bf
          JOIN public.features f ON bf.feature_id = f.id
          WHERE bf.business_id = $1 AND f.module_id = $2 AND bf.is_active = true
          ORDER BY f.name ASC
        `, [businessId, mod.id]);

        const allowedFeatures = (permsByModule && permsByModule[mod.id])
          ? bizFeatures.filter(f => permsByModule[mod.id].has(f.id))
          : bizFeatures;

        const pages = buildModulePages(mod, allowedFeatures);
        if (pages.length > 0) {
          menuModules.push({
            id: mod.id, code: mod.code, name: mod.name, icon: mod.icon,
            features: allowedFeatures.map(f => f.code),
            pages,
          });
        }
      }

      return res.json({
        ok: true,
        data: {
          role: { id: roleId, code: 'employee', name: roleName },
          modules: menuModules,
        },
      });
    }

    // ── Dueño / empleado público (nivel 1 y 2) ──────────────────────────────
    const headerBusinessId = req.headers['x-business-id'] || null;
    console.log('[NAV] userId:', userId, '| x-business-id header:', headerBusinessId);

    let userBiz;
    if (headerBusinessId) {
      const { rows } = await query(`
        SELECT bu.business_id, r.id AS role_id, r.code AS role_code, r.name AS role_name
        FROM public.business_users bu
        JOIN public.roles r ON bu.role_id = r.id
        WHERE bu.user_id = $1 AND bu.business_id = $2
        LIMIT 1
      `, [userId, headerBusinessId]);
      userBiz = rows;
    } else {
      const { rows } = await query(`
        SELECT bu.business_id, r.id AS role_id, r.code AS role_code, r.name AS role_name
        FROM public.business_users bu
        JOIN public.roles r ON bu.role_id = r.id
        WHERE bu.user_id = $1
        LIMIT 1
      `, [userId]);
      userBiz = rows;
    }

    console.log('[NAV] business_id usado:', userBiz[0]?.business_id);

    if (userBiz.length === 0) {
      return res.json({ ok: true, data: { role: null, modules: [] } });
    }

    const { business_id, role_id, role_code, role_name } = userBiz[0];

    const { rows: modules } = await query(`
      SELECT m.id, m.code, m.name, m.icon, m.sort_order
      FROM public.business_modules bm
      JOIN public.modules m ON bm.module_id = m.id
      WHERE bm.business_id = $1 AND bm.is_active = true
      ORDER BY m.sort_order ASC
    `, [business_id]);

    console.log('[NAV] Módulos activos:', modules.map(m => m.code));

    const menuModules = [];
    for (const mod of modules) {
      const { rows: featureRows } = await query(`
        SELECT f.id, f.code, f.name, f.description
        FROM public.business_features bf
        JOIN public.features f ON bf.feature_id = f.id
        WHERE bf.business_id = $1 AND f.module_id = $2 AND bf.is_active = true
        ORDER BY f.name ASC
      `, [business_id, mod.id]);

      console.log(`[NAV] Módulo ${mod.code} → features: [${featureRows.map(f => f.code).join(', ')}]`);

      const pages = buildModulePages(mod, featureRows);
      if (pages.length > 0) {
        menuModules.push({
          id: mod.id, code: mod.code, name: mod.name,
          icon: mod.icon, features: featureRows.map(f => f.code), pages,
        });
      }
    }

    res.json({
      ok: true,
      data: {
        role: { id: role_id, code: role_code, name: role_name },
        modules: menuModules,
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;