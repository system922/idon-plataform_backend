import express from 'express';
import { query } from '../config/database.js';
import { successResponse, errorResponse } from '../utils/response.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Get subscription for business
router.get('/', async (req, res, next) => {
  try {
    const { businessId } = req.user;

    if (!businessId) {
      return res.status(401).json(errorResponse('User context required', 401));
    }

    const result = await query(
      `SELECT s.id, s.status, s.billing_period, s.amount_monthly, s.amount_annual,
              s.total_amount, s.activated_at, s.suspended_at
       FROM public.subscriptions s
       WHERE s.business_id = $1`,
      [businessId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json(errorResponse('Subscription not found', 404));
    }

    // Get line items
    const itemsResult = await query(
      `SELECT m.code, m.name, sli.unit_price, sli.total_price
       FROM public.subscription_line_items sli
       JOIN public.modules m ON sli.module_id = m.id
       WHERE sli.subscription_id = $1`,
      [result.rows[0].id]
    );

    const subscription = result.rows[0];
    subscription.lineItems = itemsResult.rows;

    res.json(successResponse(subscription, 'Subscription fetched successfully'));
  } catch (error) {
    logger.error('Error fetching subscription:', error);
    next(error);
  }
});

// Activate subscription (admin only)
router.post('/:subscriptionId/activate', async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;

    // Calculate next billing date
    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

    await query(
      `UPDATE public.subscriptions
       SET status = $1, activated_at = NOW(), next_billing_at = $2
       WHERE id = $3`,
      ['active', nextBillingDate, subscriptionId]
    );

    res.json(successResponse(null, 'Subscription activated successfully'));
  } catch (error) {
    logger.error('Error activating subscription:', error);
    next(error);
  }
});

// Suspend subscription (admin only)
router.post('/:subscriptionId/suspend', async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { reason } = req.body;

    await query(
      `UPDATE public.subscriptions
       SET status = $1, suspended_at = NOW()
       WHERE id = $2`,
      ['suspended', subscriptionId]
    );

    logger.info(`Subscription ${subscriptionId} suspended. Reason: ${reason}`);

    res.json(successResponse(null, 'Subscription suspended'));
  } catch (error) {
    logger.error('Error suspending subscription:', error);
    next(error);
  }
});

// Cancel subscription
router.post('/:subscriptionId/cancel', async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;

    await query(
      `UPDATE public.subscriptions
       SET status = $1, cancelled_at = NOW()
       WHERE id = $2`,
      ['cancelled', subscriptionId]
    );

    res.json(successResponse(null, 'Subscription cancelled'));
  } catch (error) {
    logger.error('Error cancelling subscription:', error);
    next(error);
  }
});

export default router;
