import express from 'express';
import { query } from '../config/database.js';
import { sendRegistrationPendingEmail } from '../services/publicEmailService.js';
const router = express.Router();

// POST /api/public/send-registration-pending
router.post('/send-registration-pending', async (req, res, next) => {
  try {
    const { email, ownerName, businessName, requestDate } = req.body;
    
    // Validar campos requeridos
    if (!email || !ownerName || !businessName) {
      return res.status(400).json({ 
        ok: false, 
        message: 'Faltan campos requeridos: email, ownerName, businessName' 
      });
    }

    // Buscar la plantilla en la base de datos
    const { rows } = await query(
      `SELECT subject, body, is_active FROM public.email_templates WHERE type = $1`,
      ['registration_pending']
    );

    if (!rows.length) {
      return res.status(404).json({ 
        ok: false, 
        message: 'Plantilla no encontrada: registration_pending' 
      });
    }
    
    if (!rows[0].is_active) {
      return res.status(400).json({ 
        ok: false, 
        message: 'Plantilla inactiva' 
      });
    }

    // Formatear fecha
    const fmtDate = (d) => {
      if (!d) return new Date().toLocaleDateString('es-EC', { 
        day: '2-digit', 
        month: 'long', 
        year: 'numeric' 
      });
      return new Date(d).toLocaleDateString('es-EC', { 
        day: '2-digit', 
        month: 'long', 
        year: 'numeric' 
      });
    };

    // Variables para reemplazar
    const vars = {
      owner_name: ownerName || 'usuario',
      business_name: businessName || '—',
      email: email,
      request_date: fmtDate(requestDate),
    };

    // Función para reemplazar variables
    const interpolate = (str) =>
      str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

    const subject = interpolate(rows[0].subject);
    const html = interpolate(rows[0].body);

    // Enviar email usando el servicio existente
    await sendGenericEmail({ 
      to: email, 
      subject, 
      html, 
      businessName: 'IDON PLATAFORM' 
    });

    logger.info({ 
      to: email, 
      templateKey: 'registration_pending', 
      businessName 
    }, 'Public registration pending email sent');

    res.json({ 
      ok: true, 
      message: 'Correo de registro pendiente enviado correctamente' 
    });

  } catch (error) {
    logger.error('Error enviando email de registro pendiente:', error);
    next(error);
  }
});


// ── GET /api/public/business/:slug ──────────────────────────────────────
router.get('/business/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    // 1. Verificar que el negocio existe
    const businessResult = await query(
      `SELECT 
        b.id,
        b.slug,
        b.name,
        b.schema_name,
        b.is_active
      FROM public.businesses b
      WHERE b.slug = $1
        AND b.is_active = true
      LIMIT 1`,
      [slug]
    );
    
    if (businessResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Negocio no encontrado'
      });
    }
    
    const business = businessResult.rows[0];
    
    // 2. Verificar que el negocio tiene la feature 'orders.qr' activa
    const featureResult = await query(
      `SELECT 
        bf.id,
        bf.is_active,
        f.code,
        f.name
      FROM public.business_features bf
      JOIN public.features f ON bf.feature_id = f.id
      WHERE bf.business_id = $1
        AND f.code = 'orders.qr'
        AND bf.is_active = true
      LIMIT 1`,
      [business.id]
    );
    
    if (featureResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'El negocio no tiene activa la funcionalidad de órdenes por QR',
        code: 'FEATURE_NOT_ACTIVE'
      });
    }
    
    // 3. Devolver los datos del negocio
    res.json({
      success: true,
      business: {
        id: business.id,
        slug: business.slug,
        name: business.name,
        schema_name: business.schema_name,
        feature_active: true
      }
    });
    
  } catch (error) {
    console.error('Error en /api/public/business:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor'
    });
  }
});

// ── GET /api/public/categories ──────────────────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const { tenant } = req.query;
    
    if (!tenant) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenant es requerido' 
      });
    }
    
    const result = await query(
      `SELECT id, name FROM "${tenant}".categories WHERE is_active = true ORDER BY name`
    );
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error en /api/public/categories:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al cargar categorías' 
    });
  }
});

// ── GET /api/public/products ────────────────────────────────────────────
router.get('/products', async (req, res) => {
  try {
    const { tenant } = req.query;
    
    if (!tenant) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenant es requerido' 
      });
    }
    
    const result = await query(
      `SELECT 
        id, 
        name, 
        selling_price, 
        tax_rate, 
        category_id,
        stock,
        is_active
      FROM "${tenant}".products 
      WHERE is_active = true 
      ORDER BY name`
    );
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error en /api/public/products:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al cargar productos' 
    });
  }
});

// ── GET /api/public/fiscal-rates ────────────────────────────────────────
router.get('/fiscal-rates', async (req, res) => {
  try {
    const { tenant } = req.query;
    
    if (!tenant) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenant es requerido' 
      });
    }
    
    try {
      const result = await query(
        `SELECT iva_rate FROM "${tenant}".fiscal_config LIMIT 1`
      );
      res.json(result.rows[0] || { iva_rate: 15 });
    } catch {
      res.json({ iva_rate: 15 });
    }
    
  } catch (error) {
    console.error('Error en /api/public/fiscal-rates:', error);
    res.json({ iva_rate: 15 });
  }
});

// ── POST /api/public/orders ─────────────────────────────────────────────
router.post('/orders', async (req, res) => {
  try {
    const {
      tenant,
      business_id,
      items,
      notas,
      order_type,
      vat_rate,
      iva_percentage,
      iva_amount,
      subtotal,
      total,
      cliente_nombre,
      cliente_telefono
    } = req.body;

    if (!tenant) {
      return res.status(400).json({ 
        success: false, 
        error: 'tenant es requerido' 
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Debe incluir al menos un item' 
      });
    }

    // ── Verificar que el negocio tiene la feature activa ──────────────
    const featureCheck = await query(
      `SELECT bf.id
       FROM public.business_features bf
       JOIN public.features f ON bf.feature_id = f.id
       WHERE bf.business_id = $1
         AND f.code = 'orders.qr'
         AND bf.is_active = true
       LIMIT 1`,
      [business_id]
    );

    if (featureCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'El negocio no tiene activa la funcionalidad de órdenes por QR'
      });
    }

    // ── Generar número de orden ──────────────────────────────────────────
    const orderNumber = `QR-${Date.now().toString().slice(-6)}`;

    // ── Insertar orden ──────────────────────────────────────────────────
    const orderResult = await query(
      `INSERT INTO "${tenant}".pos_orders (
        order_number,
        order_type,
        status,
        customer_name,
        subtotal,
        tax_rate,
        tax_amount,
        total,
        notes,
        created_at,
        printed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), false)
      RETURNING id`,
      [
        orderNumber,
        order_type || 'qr',
        'pending',
        cliente_nombre || 'Cliente QR',
        subtotal || 0,
        vat_rate || 15,
        iva_amount || 0,
        total || 0,
        notas || ''
      ]
    );

    const orderId = orderResult.rows[0].id;

    // ── Insertar items ──────────────────────────────────────────────────
    for (const item of items) {
      await query(
        `INSERT INTO "${tenant}".pos_order_items (
          order_id,
          product_id,
          product_name,
          quantity,
          unit_price,
          tax_rate,
          iva_amount,
          line_total,
          notes,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          orderId,
          item.product_id || null,
          item.product_name || 'Producto',
          item.quantity || 1,
          item.unit_price || 0,
          item.tax_rate || 0,
          item.iva_amount || 0,
          item.line_total || 0,
          item.notes || ''
        ]
      );
    }

    res.json({
      success: true,
      message: 'Pedido creado exitosamente',
      pedido: {
        id: orderId,
        numero_pedido: orderNumber,
        total: total || 0
      }
    });

  } catch (error) {
    console.error('Error al crear orden pública:', error);
    res.status(500).json({
      success: false,
      error: 'Error al crear el pedido',
      details: error.message
    });
  }
});

export default router;