import { query } from '../config/database.js';
import { emitPlatformInvoice } from './platformEinvoicingService.js';

const SRI_IDENTIFICATION_TYPES = {
  cedula: '05',
  ruc: '04',
  pasaporte: '06',
  consumidor_final: '07',
};

const SRI_PAYMENT_METHODS = {
  efectivo: '01',
  transferencia: '20',
  tarjeta: '19',
  otros: '20',
};

export async function issuePlatformPaymentInvoice(billingHistoryId, customer = {}) {
  const { rows } = await query(`
    SELECT bh.*,
           s.billing_period,
           b.name AS business_name,
           bo.first_name || ' ' || COALESCE(bo.last_name, '') AS owner_name,
           bo.email AS owner_email,
           bo.document_type AS owner_document_type,
           bo.document_number AS owner_document_number
      FROM public.billing_history bh
      JOIN public.subscriptions s ON s.id = bh.subscription_id
      JOIN public.businesses b ON b.id = s.business_id
      LEFT JOIN public.business_users bu ON bu.business_id = b.id AND bu.is_owner = TRUE
      LEFT JOIN public.business_owners bo ON bo.user_id = bu.user_id
     WHERE bh.id = $1 AND bh.status = 'paid'
  `, [billingHistoryId]);

  const payment = rows[0];
  if (!payment) throw new Error('Pago confirmado no encontrado');

  const { rows: existingRows } = await query(
    'SELECT id, invoice_number, status, customer_email FROM public.platform_einvoices WHERE billing_history_id = $1',
    [billingHistoryId]
  );
  if (existingRows[0]) {
    await query(`
      UPDATE public.billing_history
         SET invoice_number = $1, invoice_status = $2, invoice_error = NULL
       WHERE id = $3
    `, [existingRows[0].invoice_number, existingRows[0].status, billingHistoryId]);
    return existingRows[0];
  }

  const customerName = customer.name?.trim() || payment.customer_name?.trim() || payment.owner_name?.trim();
  const customerEmail = customer.email?.trim() || payment.customer_email?.trim() || payment.owner_email?.trim();
  const requestedDocumentType = (customer.documentType || payment.customer_document_type || payment.owner_document_type || '').toLowerCase();
  const documentType = requestedDocumentType === 'passport' ? 'pasaporte' : requestedDocumentType;
  const documentNumber = (customer.documentNumber || payment.customer_document_number || payment.owner_document_number || '').trim();
  const identificationCode = SRI_IDENTIFICATION_TYPES[documentType];

  if (!customerName) throw new Error('El nombre del cliente de la factura es obligatorio');
  if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new Error('Ingrese un correo válido para enviar la factura');
  }
  if (!identificationCode || !documentNumber) {
    throw new Error('Complete el tipo y número de identificación del cliente para emitir la factura');
  }
  if (documentType === 'cedula' && !/^\d{10}$/.test(documentNumber)) {
    throw new Error('La cédula del cliente debe tener 10 dígitos');
  }
  if (documentType === 'ruc' && !/^\d{13}$/.test(documentNumber)) {
    throw new Error('El RUC del cliente debe tener 13 dígitos');
  }
  if (documentType === 'pasaporte' && documentNumber.length > 20) {
    throw new Error('El número de pasaporte del cliente no puede exceder 20 caracteres');
  }
  if (documentType === 'consumidor_final' && documentNumber !== '9999999999999') {
    throw new Error('La identificación de consumidor final no es válida');
  }

  const amount = Number(payment.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('El monto del pago debe ser mayor a cero para emitir la factura');
  }
  const { rows: taxRows } = await query(
    'SELECT iva_rate FROM public.fiscal_config WHERE is_active = TRUE ORDER BY updated_at DESC LIMIT 1'
  );
  const ivaRate = Number(taxRows[0]?.iva_rate);
  if (!Number.isFinite(ivaRate) || ivaRate < 0) {
    throw new Error('No existe una tasa de IVA fiscal activa para emitir la factura');
  }

  const total = Number(amount.toFixed(2));
  const subtotal = Number((total / (1 + ivaRate / 100)).toFixed(2));
  const ivaAmount = Number((total - subtotal).toFixed(2));
  const monthsPaid = Number(payment.months_paid) || 1;
  const description = `Suscripción IDON - ${payment.business_name} (${monthsPaid} ${monthsPaid === 1 ? 'mes' : 'meses'})`;
  const invoice = await emitPlatformInvoice({
    billing_history_id: billingHistoryId,
    customer: {
      tipo_identificacion: identificationCode,
      ruc: documentNumber,
      name: customerName,
      email: customerEmail,
    },
    items: [{
      code: 'IDON-SUBSCRIPTION',
      description,
      qty: 1,
      unit_price: subtotal,
      subtotal,
      iva_rate_pct: ivaRate,
      iva_amount: ivaAmount,
    }],
    subtotal,
    iva_amount: ivaAmount,
    total,
    forma_pago: SRI_PAYMENT_METHODS[payment.payment_method] || '20',
  });

  await query(`
    UPDATE public.billing_history
       SET invoice_number = $1, invoice_status = $2, invoice_error = NULL
     WHERE id = $3
  `, [invoice.invoice_number, invoice.status, billingHistoryId]);

  return invoice;
}
