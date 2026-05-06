import express from 'express';
import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';
import { successResponse } from '../../utils/response.js';

const router = express.Router();

// GET /api/admin/stats
router.get('/stats', async (req, res, next) => {
  try {
    const [businesses, pending, modules, subscriptions, users, features] = await Promise.all([
      query('SELECT COUNT(*) FROM public.businesses WHERE is_active = TRUE'),
      query("SELECT COUNT(*) FROM public.business_registration_requests WHERE status = 'pending'"),
      query('SELECT COUNT(*) FROM public.modules'),
      query(`SELECT COALESCE(SUM(total_amount),0) as total FROM public.subscriptions
             WHERE status = 'active' AND billing_period = 'monthly'`),
      query('SELECT COUNT(*) FROM public.users'),
      query('SELECT COUNT(*) FROM public.features'),
    ]);
    res.json(successResponse({
      activeBusinesses: parseInt(businesses.rows[0].count, 10),
      pendingRequests:  parseInt(pending.rows[0].count, 10),
      totalModules:     parseInt(modules.rows[0].count, 10),
      monthlyRevenue:   parseFloat(subscriptions.rows[0].total),
      totalUsers:       parseInt(users.rows[0].count, 10),
      totalFeatures:    parseInt(features.rows[0].count, 10),
    }, 'Stats fetched'));
  } catch (error) {
    logger.error('Error obteniendo stats:', error);
    next(error);
  }
});

// GET /api/admin/analytics
router.get('/analytics', async (req, res, next) => {
  try {
    const [
      businesses, pendingReqs, activesSubs, suspendedSubs,
      totalRevenue, monthRevenue, users, modules,
      recentBusinesses, upcomingPayments
    ] = await Promise.all([
      query('SELECT COUNT(*) FROM public.businesses'),
      query("SELECT COUNT(*) FROM public.business_registration_requests WHERE status='pending'"),
      query("SELECT COUNT(*) FROM public.subscriptions WHERE status='active'"),
      query("SELECT COUNT(*) FROM public.subscriptions WHERE status='suspended'"),
      query("SELECT COALESCE(SUM(amount),0) AS total FROM public.billing_history WHERE status='paid'"),
      query(`SELECT COALESCE(SUM(amount),0) AS total FROM public.billing_history
             WHERE status='paid' AND date_trunc('month',billing_date)=date_trunc('month',NOW())`),
      query('SELECT COUNT(*) FROM public.users'),
      query('SELECT COUNT(*) FROM public.modules WHERE is_active=TRUE'),
      query(`SELECT b.name, bt.name AS type, b.created_at FROM public.businesses b
             JOIN public.business_types bt ON b.business_type_id=bt.id
             ORDER BY b.created_at DESC LIMIT 5`),
      query(`SELECT b.name AS business_name, s.next_billing_at, s.total_amount, s.status
             FROM public.subscriptions s JOIN public.businesses b ON s.business_id=b.id
             WHERE s.status='active' AND s.next_billing_at IS NOT NULL
             ORDER BY s.next_billing_at ASC LIMIT 10`),
    ]);

    const { rows: monthlyData } = await query(`
      SELECT date_trunc('month', billing_date) AS month,
             SUM(amount) AS total, COUNT(*) AS count
      FROM public.billing_history WHERE status='paid'
        AND billing_date >= NOW() - INTERVAL '6 months'
      GROUP BY 1 ORDER BY 1
    `);

    const { rows: typesDist } = await query(`
      SELECT bt.name, COUNT(*) AS count
      FROM public.businesses b JOIN public.business_types bt ON b.business_type_id=bt.id
      GROUP BY bt.name ORDER BY count DESC
    `);

    res.json({ ok: true, data: {
      totals: {
        businesses:      parseInt(businesses.rows[0].count),
        pendingRequests: parseInt(pendingReqs.rows[0].count),
        activesSubs:     parseInt(activesSubs.rows[0].count),
        suspendedSubs:   parseInt(suspendedSubs.rows[0].count),
        totalRevenue:    parseFloat(totalRevenue.rows[0].total),
        monthRevenue:    parseFloat(monthRevenue.rows[0].total),
        users:           parseInt(users.rows[0].count),
        modules:         parseInt(modules.rows[0].count),
      },
      monthlyRevenue:   monthlyData,
      businessTypes:    typesDist,
      recentBusinesses: recentBusinesses.rows,
      upcomingPayments: upcomingPayments.rows,
    }});
  } catch (e) { next(e); }
});

export default router;
