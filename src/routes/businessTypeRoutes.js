// routes/businessTypeRoutes.js
import express from 'express';
import { query } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

// GET /api/admin/business-types
router.get('/business-types', async (req, res) => {
  try {
    const result = await query('SELECT * FROM public.business_types ORDER BY name');
    res.json({ 
      ok: true, 
      data: result.rows 
    });
  } catch (error) {
    logger.error('❌ Error en GET /business-types:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// GET /api/admin/business-types/:id
router.get('/business-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM public.business_types WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Business type not found' 
      });
    }
    
    res.json({ 
      ok: true, 
      data: result.rows[0] 
    });
  } catch (error) {
    logger.error('❌ Error en GET /business-types/:id:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// POST /api/admin/business-types
router.post('/business-types', async (req, res) => {
  try {
    const { code, name, description, is_active = true } = req.body;
    
    // Validaciones
    if (!code || !name) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Código y nombre son requeridos' 
      });
    }
    
    // Verificar si ya existe un tipo con ese código
    const existing = await query(
      'SELECT id FROM public.business_types WHERE code = $1',
      [code]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        ok: false, 
        error: `Ya existe un tipo de negocio con el código "${code}"` 
      });
    }
    
    const result = await query(
      `INSERT INTO public.business_types (code, name, description, is_active)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [code, name, description, is_active]
    );
    
    res.status(201).json({ 
      ok: true, 
      data: result.rows[0] 
    });
  } catch (error) {
    logger.error('❌ Error en POST /business-types:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// PUT /api/admin/business-types/:id
router.put('/business-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, description, is_active } = req.body;
    
    // Validaciones
    if (!code || !name) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Código y nombre son requeridos' 
      });
    }
    
    // Verificar si existe el tipo
    const existing = await query(
      'SELECT id FROM public.business_types WHERE id = $1',
      [id]
    );
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Business type not found' 
      });
    }
    
    // Verificar si el código ya está en uso por otro registro
    const duplicate = await query(
      'SELECT id FROM public.business_types WHERE code = $1 AND id != $2',
      [code, id]
    );
    
    if (duplicate.rows.length > 0) {
      return res.status(400).json({ 
        ok: false, 
        error: `Ya existe otro tipo de negocio con el código "${code}"` 
      });
    }
    
    const result = await query(
      `UPDATE public.business_types 
       SET code = $1, name = $2, description = $3, is_active = $4, updated_at = NOW() 
       WHERE id = $5 RETURNING *`,
      [code, name, description, is_active, id]
    );
    
    res.json({ 
      ok: true, 
      data: result.rows[0] 
    });
  } catch (error) {
    logger.error('❌ Error en PUT /business-types/:id:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// DELETE /api/admin/business-types/:id
router.delete('/business-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar si existe
    const existing = await query(
      'SELECT id FROM public.business_types WHERE id = $1',
      [id]
    );
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Business type not found' 
      });
    }
    
    // Verificar si está siendo usado por algún negocio
    const inUse = await query(
      'SELECT id FROM public.businesses WHERE business_type_id = $1 LIMIT 1',
      [id]
    );
    
    if (inUse.rows.length > 0) {
      return res.status(400).json({ 
        ok: false, 
        error: 'No se puede eliminar el tipo porque está siendo usado por uno o más negocios' 
      });
    }
    
    await query('DELETE FROM public.business_types WHERE id = $1', [id]);
    
    res.json({ 
      ok: true, 
      message: 'Business type deleted successfully' 
    });
  } catch (error) {
    logger.error('❌ Error en DELETE /business-types/:id:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

export default router;