import express from 'express';
import { db } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/business/by-whatsapp/:whatsapp
 * Obtiene el negocio asociado a un número de WhatsApp
 */
router.get('/by-whatsapp/:whatsapp', async (req, res) => {
  try {
    const { whatsapp } = req.params;
    
    // Limpiar el número (solo dígitos)
    const cleanWhatsapp = whatsapp.replace(/[^0-9]/g, '');
    
    if (!cleanWhatsapp || cleanWhatsapp.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Número de WhatsApp inválido'
      });
    }
    
    console.log(`🔍 Buscando negocio para WhatsApp: ${cleanWhatsapp}`);
    
    // business_registration_requests
    const result = await db.query(
      `SELECT 
        brr.id,
        brr.slug,
        brr.business_name,
        brr.owner_phone,
        brr.schema_name,
        brr.status,
        brr.provisioned_business_id,
        b.is_active,
        b.name as business_name_active
      FROM public.business_registration_requests brr
      LEFT JOIN public.businesses b ON b.id = brr.provisioned_business_id
      WHERE brr.owner_phone = $1
        AND brr.status IN ('approved', 'provisioned')
      LIMIT 1`,
      [cleanWhatsapp]
    );
    
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No se encontró negocio para el WhatsApp: ${cleanWhatsapp}`
      });
    }
    
    const negocio = result.rows[0];
    
    res.json({
      success: true,
      business: {
        id: negocio.id,
        slug: negocio.slug,
        name: negocio.business_name_active || negocio.business_name,
        owner_phone: negocio.owner_phone,
        schema_name: negocio.schema_name,
        business_id: negocio.provisioned_business_id,
        status: negocio.status,
        is_active: negocio.is_active ?? true
      }
    });
    
  } catch (error) {
    console.error('❌ Error buscando negocio:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al buscar negocio',
      details: error.message
    });
  }
});

/**
 * GET /api/business/by-whatsapp/:whatsapp/tenant
 * Obtiene solo el tenant (schema_name) para un número de WhatsApp
 * Útil para n8n
 */
router.get('/by-whatsapp/:whatsapp/tenant', async (req, res) => {
  try {
    const { whatsapp } = req.params;
    const cleanWhatsapp = whatsapp.replace(/[^0-9]/g, '');
    
    if (!cleanWhatsapp || cleanWhatsapp.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Número de WhatsApp inválido'
      });
    }
    
    const result = await db.query(
      `SELECT 
        brr.schema_name,
        brr.slug,
        brr.business_name,
        brr.provisioned_business_id
      FROM public.business_registration_requests brr
      WHERE brr.owner_phone = $1
        AND brr.status IN ('approved', 'provisioned')
      LIMIT 1`,
      [cleanWhatsapp]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No se encontró negocio para el WhatsApp: ${cleanWhatsapp}`
      });
    }
    
    const negocio = result.rows[0];
    
    res.json({
      success: true,
      tenant: negocio.schema_name,
      slug: negocio.slug,
      business_name: negocio.business_name,
      business_id: negocio.provisioned_business_id
    });
    
  } catch (error) {
    console.error('❌ Error buscando tenant:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al buscar tenant'
    });
  }
});

export default router;