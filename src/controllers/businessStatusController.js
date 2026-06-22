// src/controllers/businessStatusController.js
import { query } from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * GET /api/business/status
 * Obtiene el estado del negocio del usuario autenticado
 */
export const getBusinessStatus = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const businessId = req.user?.businessId;

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
        totalAmount: subscription.total_amount,
        discountPercentage: subscription.discount_percentage
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
    'suspended': 'Tu negocio ha sido suspendido. Contacta a soporte para más información.',
    'inactive': 'Tu negocio está inactivo. Contacta a soporte para reactivarlo.',
    'pending': 'Tu negocio está pendiente de verificación. Pronto recibirás noticias.',
    'payment_pending': 'Tienes pagos pendientes. Realiza el pago para continuar usando el servicio.'
  };
  return messages[status] || 'Estado desconocido';
}