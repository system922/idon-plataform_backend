// ========== backend/routes/admin/businesses.js ==========
import express from 'express';
import { query } from '../../config/database.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// ─── GET /api/admin/businesses/stats ──────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    logger.info('[BUSINESS-STATS] Obteniendo estadísticas de negocios');

    // 1. Obtener todos los negocios con información básica
    const businessesResult = await query(`
      SELECT 
        b.id,
        b.name,
        b.slug,
        b.schema_name,
        b.is_active,
        b.is_verified,
        b.created_at,
        b.updated_at,
        bt.name AS business_type,
        u.email AS client_email,
        u.first_name AS client_first_name,
        u.last_name AS client_last_name,
        bo.id AS owner_id,
        COALESCE(s.status, 'no_subscription') AS subscription_status,
        s.activated_at AS subscription_activated_at,
        s.next_billing_at,
        s.suspended_at,
        (SELECT COUNT(*) FROM public.business_users WHERE business_id = b.id AND is_active = TRUE) AS total_users,
        (SELECT COUNT(*) FROM public.business_users WHERE business_id = b.id AND is_active = TRUE AND role_id IS NOT NULL) AS active_users
      FROM public.businesses b
      LEFT JOIN public.business_types bt ON b.business_type_id = bt.id
      LEFT JOIN public.business_owners bo ON b.id = bo.business_id
      LEFT JOIN public.users u ON bo.user_id = u.id
      LEFT JOIN public.subscriptions s ON b.id = s.business_id AND s.status = 'active'
      WHERE b.is_active = TRUE
      ORDER BY b.created_at DESC
    `);

    const businesses = businessesResult.rows;

    // 2. Para cada negocio, obtener estadísticas adicionales
    const statsPromises = businesses.map(async (business) => {
      try {
        // Verificar si el schema existe antes de consultar
        let schemaExists = false;
        try {
          const schemaCheck = await query(`
            SELECT schema_name FROM information_schema.schemata 
            WHERE schema_name = $1
          `, [business.schema_name]);
          schemaExists = schemaCheck.rows.length > 0;
        } catch {
          schemaExists = false;
        }

        let revenueResult = { rows: [{ total_revenue: 0, monthly_revenue: 0, total_sales: 0 }] };
        let modulesResult = { rows: [] };
        let monthlyDataResult = { rows: [] };
        let growthResult = { rows: [{ growth_percentage: 0 }] };
        let topProductsResult = { rows: [] };
        let customersResult = { rows: [{ total_customers: 0, active_customers: 0 }] };
        let activeModulesResult = { rows: [] };

        if (schemaExists) {
          try {
            revenueResult = await query(`
              SELECT 
                COALESCE(SUM(total), 0) AS total_revenue,
                COALESCE(SUM(total), 0) AS monthly_revenue,
                COUNT(*) AS total_sales
              FROM "${business.schema_name}".sales
              WHERE created_at >= NOW() - INTERVAL '30 days'
                AND status = 'completed'
            `);
          } catch { /* tabla no existe */ }

          try {
            modulesResult = await query(`
              SELECT 
                m.name,
                m.code,
                COUNT(DISTINCT um.user_id) AS user_count
              FROM "${business.schema_name}".modules m
              LEFT JOIN "${business.schema_name}".user_modules um ON m.id = um.module_id
              WHERE m.is_active = TRUE
              GROUP BY m.id, m.name, m.code
              ORDER BY m.name
            `);
          } catch { /* tabla no existe */ }

          try {
            monthlyDataResult = await query(`
              SELECT 
                TO_CHAR(DATE_TRUNC('month', created_at), 'MM/YYYY') AS month,
                COALESCE(SUM(total), 0) AS revenue,
                COUNT(DISTINCT customer_id) AS customers,
                COUNT(*) AS sales
              FROM "${business.schema_name}".sales
              WHERE created_at >= NOW() - INTERVAL '6 months'
                AND status = 'completed'
              GROUP BY DATE_TRUNC('month', created_at)
              ORDER BY DATE_TRUNC('month', created_at)
              LIMIT 6
            `);
          } catch { /* tabla no existe */ }

          try {
            growthResult = await query(`
              WITH monthly_revenue AS (
                SELECT 
                  DATE_TRUNC('month', created_at) AS month,
                  COALESCE(SUM(total), 0) AS revenue
                FROM "${business.schema_name}".sales
                WHERE created_at >= NOW() - INTERVAL '2 months'
                  AND status = 'completed'
                GROUP BY DATE_TRUNC('month', created_at)
                ORDER BY month DESC
                LIMIT 2
              )
              SELECT 
                COALESCE(
                  ((SELECT revenue FROM monthly_revenue ORDER BY month DESC LIMIT 1) - 
                   (SELECT revenue FROM monthly_revenue ORDER BY month DESC LIMIT 1 OFFSET 1)) / 
                  NULLIF((SELECT revenue FROM monthly_revenue ORDER BY month DESC LIMIT 1 OFFSET 1), 0) * 100,
                  0
                ) AS growth_percentage
            `);
          } catch { /* tabla no existe */ }

          try {
            topProductsResult = await query(`
              SELECT 
                p.name,
                COUNT(si.id) AS sales_count,
                COALESCE(SUM(si.quantity), 0) AS total_quantity,
                COALESCE(SUM(si.subtotal), 0) AS total_revenue
              FROM "${business.schema_name}".sales_items si
              JOIN "${business.schema_name}".products p ON si.product_id = p.id
              JOIN "${business.schema_name}".sales s ON si.sale_id = s.id
              WHERE s.created_at >= NOW() - INTERVAL '30 days'
                AND s.status = 'completed'
              GROUP BY p.id, p.name
              ORDER BY total_revenue DESC
              LIMIT 5
            `);
          } catch { /* tabla no existe */ }

          try {
            customersResult = await query(`
              SELECT 
                COUNT(*) AS total_customers,
                COUNT(DISTINCT id) AS active_customers
              FROM "${business.schema_name}".customers
              WHERE is_active = TRUE
            `);
          } catch { /* tabla no existe */ }

          try {
            activeModulesResult = await query(`
              SELECT 
                m.id,
                m.name,
                m.code,
                m.icon,
                m.is_active
              FROM "${business.schema_name}".modules m
              WHERE m.is_active = TRUE
              ORDER BY m.name
            `);
          } catch { /* tabla no existe */ }
        }

        return {
          id: business.id,
          name: business.name,
          slug: business.slug,
          schema_name: business.schema_name,
          status: business.is_active ? 'active' : 'inactive',
          is_verified: business.is_verified,
          created_at: business.created_at,
          business_type: business.business_type || 'No definido',
          client_name: `${business.client_first_name || ''} ${business.client_last_name || ''}`.trim() || 'Sin cliente',
          client_email: business.client_email || 'Sin email',
          subscription_status: business.subscription_status || 'no_subscription',
          subscription_activated_at: business.subscription_activated_at,
          next_billing_at: business.next_billing_at,
          suspended_at: business.suspended_at,
          total_users: parseInt(business.total_users) || 0,
          active_users: parseInt(business.active_users) || 0,
          total_revenue: parseFloat(revenueResult.rows[0]?.total_revenue) || 0,
          monthly_revenue: parseFloat(revenueResult.rows[0]?.monthly_revenue) || 0,
          total_sales: parseInt(revenueResult.rows[0]?.total_sales) || 0,
          growth: parseFloat(growthResult.rows[0]?.growth_percentage) || 0,
          modules: activeModulesResult.rows || [],
          module_stats: modulesResult.rows || [],
          monthly_data: monthlyDataResult.rows.map(row => ({
            month: row.month,
            revenue: parseFloat(row.revenue) || 0,
            customers: parseInt(row.customers) || 0,
            sales: parseInt(row.sales) || 0
          })),
          top_products: topProductsResult.rows || [],
          customers: {
            total: parseInt(customersResult.rows[0]?.total_customers) || 0,
            active: parseInt(customersResult.rows[0]?.active_customers) || 0
          },
          active_modules: activeModulesResult.rows.length || 0
        };
      } catch (err) {
        logger.error(`[BUSINESS-STATS] Error obteniendo stats para negocio ${business.id}:`, err);
        return {
          id: business.id,
          name: business.name,
          error: true,
          error_message: err.message
        };
      }
    });

    const statsData = await Promise.all(statsPromises);

    // 3. Estadísticas generales (resumen)
    const validBusinesses = statsData.filter(b => !b.error);
    const totalBusinesses = validBusinesses.length;
    const activeBusinesses = validBusinesses.filter(b => b.status === 'active').length;
    const totalUsers = validBusinesses.reduce((sum, b) => sum + (b.total_users || 0), 0);
    const totalRevenue = validBusinesses.reduce((sum, b) => sum + (b.total_revenue || 0), 0);
    const totalModules = validBusinesses.reduce((sum, b) => sum + (b.active_modules || 0), 0);

    const summary = {
      total_businesses: totalBusinesses,
      active_businesses: activeBusinesses,
      inactive_businesses: totalBusinesses - activeBusinesses,
      total_users: totalUsers,
      total_revenue: totalRevenue,
      total_modules: totalModules,
      average_revenue: totalBusinesses > 0 ? totalRevenue / totalBusinesses : 0
    };

    res.json(successResponse({
      businesses: statsData,
      summary: summary,
      last_updated: new Date().toISOString()
    }, 'Estadísticas obtenidas exitosamente'));

  } catch (error) {
    logger.error('[BUSINESS-STATS] Error:', error);
    next(error);
  }
});

// ─── GET /api/admin/businesses/:id ─────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const businessResult = await query(`
      SELECT 
        b.id,
        b.name,
        b.slug,
        b.schema_name,
        b.is_active,
        b.is_verified,
        b.created_at,
        b.updated_at,
        bt.name AS business_type,
        bt.code AS business_type_code,
        u.email AS client_email,
        u.first_name AS client_first_name,
        u.last_name AS client_last_name,
        u.phone AS client_phone,
        bo.id AS owner_id,
        COALESCE(s.status, 'no_subscription') AS subscription_status,
        s.activated_at AS subscription_activated_at,
        s.next_billing_at,
        s.suspended_at,
        s.amount_monthly,
        s.amount_annual,
        s.billing_period
      FROM public.businesses b
      LEFT JOIN public.business_types bt ON b.business_type_id = bt.id
      LEFT JOIN public.business_owners bo ON b.id = bo.business_id
      LEFT JOIN public.users u ON bo.user_id = u.id
      LEFT JOIN public.subscriptions s ON b.id = s.business_id
      WHERE b.id = $1
    `, [id]);

    if (businessResult.rows.length === 0) {
      return res.status(404).json(errorResponse('Negocio no encontrado', 404));
    }

    const business = businessResult.rows[0];

    let usersResult = { rows: [] };
    let billingResult = { rows: [] };

    try {
      const schemaCheck = await query(`
        SELECT schema_name FROM information_schema.schemata 
        WHERE schema_name = $1
      `, [business.schema_name]);
      
      if (schemaCheck.rows.length > 0) {
        usersResult = await query(`
          SELECT 
            u.id,
            u.first_name,
            u.last_name,
            u.email,
            u.phone,
            r.name AS role_name,
            r.code AS role_code,
            u.is_active,
            u.created_at AS joined_at
          FROM "${business.schema_name}".users u
          LEFT JOIN "${business.schema_name}".roles r ON u.role_id = r.id
          ORDER BY u.created_at DESC
          LIMIT 50
        `);
      }
    } catch { /* schema no existe */ }

    try {
      billingResult = await query(`
        SELECT 
          bh.id,
          bh.billing_date,
          bh.amount,
          bh.status,
          bh.payment_method,
          bh.description,
          bh.created_at
        FROM public.billing_history bh
        JOIN public.subscriptions s ON bh.subscription_id = s.id
        WHERE s.business_id = $1
        ORDER BY bh.billing_date DESC
        LIMIT 20
      `, [id]);
    } catch { /* tabla no existe */ }

    res.json(successResponse({
      business: {
        ...business,
        users: usersResult.rows || [],
        billing_history: billingResult.rows || []
      }
    }, 'Detalle del negocio obtenido exitosamente'));

  } catch (error) {
    logger.error('[BUSINESS-DETAIL] Error:', error);
    next(error);
  }
});

export default router;