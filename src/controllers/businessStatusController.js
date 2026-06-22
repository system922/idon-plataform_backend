// src/controllers/businessStatusController.js
import { query } from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * GET /api/business-status/my-status
 * Obtiene el estado del negocio del usuario autenticado con TODOS los datos de suscripción
 */
export const getMyStatus = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const businessId = req.user?.businessId || req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: 'Business context required'
      });
    }

    // 🔥 CONSULTA COMPLETA CON TODOS LOS CAMPOS DE SUSCRIPCIÓN
    const result = await query(
      `SELECT 
        b.id, 
        b.slug, 
        b.name, 
        b.is_active, 
        b.is_verified,
        bt.name as type,
        s.id as subscription_id,
        s.status as subscription_status,
        s.suspended_at,
        s.next_billing_at,
        s.activated_at,
        s.billing_period,
        s.total_amount,
        s.amount_monthly,
        s.amount_annual,
        s.discount_percentage,
        s.billing_day,
        (SELECT COUNT(*) FROM public.billing_history bh
         WHERE bh.subscription_id = s.id
           AND bh.status = 'pending'
           AND bh.billing_date <= NOW()) as pending_payments_count
       FROM public.businesses b
       LEFT JOIN public.business_types bt ON b.business_type_id = bt.id
       LEFT JOIN public.subscriptions s ON b.id = s.business_id
       WHERE b.id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [businessId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Business not found'
      });
    }

    const business = result.rows[0];
    const hasPendingPayment = parseInt(business.pending_payments_count || '0') > 0;
    const subStatus = business.subscription_status || 'pending_activation';
    
    let status = 'active';
    let isSuspended = false;
    
    if (subStatus === 'suspended' || subStatus === 'inactive' || !business.is_active) {
      status = 'suspended';
      isSuspended = true;
    } else if (hasPendingPayment) {
      status = 'payment_pending';
    } else if (subStatus === 'pending_activation' || !business.is_verified) {
      status = 'pending';
    }

    // 🔥 CONSTRUIR RESPUESTA CON TODOS LOS DATOS
    const response = {
      ok: true,
      status: status,
      isActive: business.is_active,
      isVerified: business.is_verified,
      isSuspended: isSuspended,
      hasPendingPayment: hasPendingPayment,
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        type: business.type
      },
      subscription: {
        id: business.subscription_id,
        status: business.subscription_status,
        billingPeriod: business.billing_period,
        billingDay: business.billing_day,
        nextBillingAt: business.next_billing_at,
        activatedAt: business.activated_at,
        suspendedAt: business.suspended_at,
        // 🔥 CAMPOS DE MONTO (CON AMBOS NOMBRES PARA COMPATIBILIDAD)
        totalAmount: parseFloat(business.total_amount || 0),
        total_amount: parseFloat(business.total_amount || 0),
        amountMonthly: parseFloat(business.amount_monthly || 0),
        amount_monthly: parseFloat(business.amount_monthly || 0),
        amountAnnual: parseFloat(business.amount_annual || 0),
        amount_annual: parseFloat(business.amount_annual || 0),
        discountPercentage: parseFloat(business.discount_percentage || 0),
        discount_percentage: parseFloat(business.discount_percentage || 0)
      },
      message: getStatusMessage(status)
    };

    logger.info(`[BUSINESS-STATUS] Business ${business.id} - Status: ${status}`);
    res.json(response);

  } catch (error) {
    logger.error('Error getting business status:', error);
    res.status(500).json({
      ok: false,
      error: 'Error al obtener el estado del negocio',
      detail: error.message
    });
  }
};

/**
 * GET /api/business/status - Versión legacy (mantener por compatibilidad)
 */
export const getBusinessStatus = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const businessId = req.user?.businessId || req.user?.business_id;

    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: 'Business context required'
      });
    }

    // 1. Obtener información del negocio
    const businessResult = await query(
      `SELECT b.id, b.slug, b.name, b.is_active, b.is_verified,
              b.schema_name, b.business_type_id,
              b.status, b.suspended_at, b.suspension_reason,
              b.created_at, b.updated_at
       FROM public.businesses b
       WHERE b.id = $1`,
      [businessId]
    );

    if (businessResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Business not found'
      });
    }

    const business = businessResult.rows[0];

    // 2. Verificar si el negocio está suspendido
    const isSuspended = business.status === 'suspended' || 
                        business.status === 'inactive' ||
                        !business.is_active;

    // 3. Verificar si tiene pagos pendientes
    const paymentResult = await query(
      `SELECT COUNT(*) as pending_count
       FROM public.billing_history bh
       JOIN public.subscriptions s ON bh.subscription_id = s.id
       WHERE s.business_id = $1
         AND bh.status = 'pending'
         AND bh.billing_date <= NOW()`,
      [businessId]
    );

    const hasPendingPayment = parseInt(paymentResult.rows[0].pending_count) > 0;

    // 4. Obtener información de la suscripción activa
    const subscriptionResult = await query(
      `SELECT s.id, s.status, s.billing_period, 
              s.amount_monthly, s.amount_annual,
              s.next_billing_at, s.activated_at,
              s.total_amount, s.discount_percentage
       FROM public.subscriptions s
       WHERE s.business_id = $1
         AND s.is_active = TRUE
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [businessId]
    );

    const subscription = subscriptionResult.rows[0] || null;

    // 5. Obtener el plan del negocio
    let plan = null;
    if (subscription) {
      // Obtener módulos activos del negocio
      const modulesResult = await query(
        `SELECT m.id, m.code, m.name, m.price_monthly, m.price_annual
         FROM public.business_modules bm
         JOIN public.modules m ON bm.module_id = m.id
         WHERE bm.business_id = $1 AND bm.is_active = TRUE`,
        [businessId]
      );

      plan = {
        name: 'Plan Personalizado',
        features: modulesResult.rows.map(m => m.name),
        price_monthly: modulesResult.rows.reduce((sum, m) => sum + (m.price_monthly || 0), 0),
        price_annual: modulesResult.rows.reduce((sum, m) => sum + (m.price_annual || 0), 0),
        modules: modulesResult.rows
      };
    }

    // 6. Obtener pagos pendientes detallados
    const pendingPaymentsResult = await query(
      `SELECT bh.id, bh.amount, bh.billing_date, bh.status, bh.description,
              bh.invoice_number, bh.billing_period
       FROM public.billing_history bh
       JOIN public.subscriptions s ON bh.subscription_id = s.id
       WHERE s.business_id = $1
         AND bh.status = 'pending'
       ORDER BY bh.billing_date ASC`,
      [businessId]
    );

    // 7. Determinar el estado final del negocio
    let status = 'active';
    if (isSuspended) {
      status = business.status || 'suspended';
    } else if (hasPendingPayment) {
      status = 'payment_pending';
    } else if (!business.is_verified) {
      status = 'pending';
    }

    // 8. Construir respuesta
    const response = {
      ok: true,
      status: status,
      isActive: business.is_active,
      isVerified: business.is_verified,
      isSuspended: isSuspended,
      hasPendingPayment: hasPendingPayment,
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        schemaName: business.schema_name,
        status: business.status,
        suspendedAt: business.suspended_at,
        suspensionReason: business.suspension_reason
      },
      subscription: subscription ? {
        id: subscription.id,
        status: subscription.status,
        billingPeriod: subscription.billing_period,
        nextBillingAt: subscription.next_billing_at,
        activatedAt: subscription.activated_at,
        totalAmount: parseFloat(subscription.total_amount || 0),
        total_amount: parseFloat(subscription.total_amount || 0),
        amountMonthly: parseFloat(subscription.amount_monthly || 0),
        amount_monthly: parseFloat(subscription.amount_monthly || 0),
        amountAnnual: parseFloat(subscription.amount_annual || 0),
        amount_annual: parseFloat(subscription.amount_annual || 0),
        discountPercentage: parseFloat(subscription.discount_percentage || 0),
        discount_percentage: parseFloat(subscription.discount_percentage || 0)
      } : null,
      plan: plan,
      pendingPayments: pendingPaymentsResult.rows.map(p => ({
        id: p.id,
        amount: p.amount,
        dueDate: p.billing_date,
        description: p.description || 'Pago de suscripción',
        invoiceNumber: p.invoice_number,
        billingPeriod: p.billing_period
      })),
      message: getStatusMessage(status)
    };

    logger.info(`[BUSINESS-STATUS] Business ${business.id} - Status: ${status}`);
    res.json(response);

  } catch (error) {
    logger.error('Error getting business status:', error);
    res.status(500).json({
      ok: false,
      error: 'Error al obtener el estado del negocio',
      detail: error.message
    });
  }
};

/**
 * Actualizar el estado de un negocio (admin only)
 * PUT /api/business/status/:businessId
 */
export const updateBusinessStatus = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { status, reason } = req.body;
    const adminId = req.user?.userId;

    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: 'Business ID required'
      });
    }

    const validStatuses = ['active', 'suspended', 'inactive', 'pending'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid status. Allowed: ${validStatuses.join(', ')}`
      });
    }

    // Actualizar estado del negocio
    const result = await query(
      `UPDATE public.businesses
       SET status = $1,
           suspended_at = CASE WHEN $1 = 'suspended' THEN NOW() ELSE NULL END,
           suspension_reason = CASE WHEN $1 = 'suspended' THEN $2 ELSE NULL END,
           is_active = CASE WHEN $1 = 'active' THEN TRUE ELSE FALSE END,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, status, suspended_at, suspension_reason, is_active`,
      [status, reason || null, businessId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Business not found'
      });
    }

    // Registrar en auditoría
    await query(
      `INSERT INTO public.audit_logs
       (user_id, table_name, action, record_id, new_values, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        adminId,
        'businesses',
        'update_status',
        businessId,
        JSON.stringify({ status, reason }),
        `Business status updated to ${status} by admin ${adminId}`
      ]
    );

    logger.info(`[BUSINESS-STATUS] Business ${businessId} status updated to ${status} by admin ${adminId}`);

    res.json({
      ok: true,
      data: result.rows[0],
      message: `Business status updated to ${status}`
    });

  } catch (error) {
    logger.error('Error updating business status:', error);
    res.status(500).json({
      ok: false,
      error: 'Error al actualizar el estado del negocio',
      detail: error.message
    });
  }
};

/**
 * Helper para obtener mensaje según estado
 */
function getStatusMessage(status) {
  const messages = {
    'active': 'Tu negocio está activo y funcionando correctamente.',
    'suspended': 'Tu negocio está suspendido. Por favor realiza el pago para reactivarlo.',
    'inactive': 'Tu negocio está inactivo. Contacta a soporte para reactivarlo.',
    'pending': 'Tu negocio está pendiente de verificación. Pronto recibirás noticias.',
    'payment_pending': 'Tienes pagos pendientes. Realiza el pago para continuar usando el servicio.'
  };
  return messages[status] || 'Estado desconocido';
}