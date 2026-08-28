// controllers/businessTypeController.js
import * as businessTypeService from '../services/businessTypeService.js';

export const getAllBusinessTypes = async (req, res) => {
  try {
    const businessTypes = await businessTypeService.getAllBusinessTypes();
    // ✅ Devolver con la misma estructura que módulos
    res.json({ 
      ok: true, 
      data: businessTypes 
    });
  } catch (error) {
    console.error('❌ Error en getAllBusinessTypes:', error);
    res.status(500).json({ 
      ok: false,
      error: error.message 
    });
  }
};

export const getBusinessTypeById = async (req, res) => {
  try {
    const businessType = await businessTypeService.getBusinessTypeById(req.params.id);
    if (!businessType) {
      return res.status(404).json({ 
        ok: false,
        error: 'Business type not found' 
      });
    }
    res.json({ 
      ok: true, 
      data: businessType 
    });
  } catch (error) {
    console.error('❌ Error en getBusinessTypeById:', error);
    res.status(500).json({ 
      ok: false,
      error: error.message 
    });
  }
};

export const createBusinessType = async (req, res) => {
  try {
    const { code, name, description, is_active } = req.body;
    
    // Validaciones
    if (!code || !name) {
      return res.status(400).json({ 
        ok: false,
        error: 'Código y nombre son requeridos' 
      });
    }
    
    const newBusinessType = await businessTypeService.createBusinessType(req.body);
    res.status(201).json({ 
      ok: true, 
      data: newBusinessType 
    });
  } catch (error) {
    console.error('❌ Error en createBusinessType:', error);
    res.status(500).json({ 
      ok: false,
      error: error.message 
    });
  }
};

export const updateBusinessType = async (req, res) => {
  try {
    const { code, name, description, is_active } = req.body;
    
    // Validaciones
    if (!code || !name) {
      return res.status(400).json({ 
        ok: false,
        error: 'Código y nombre son requeridos' 
      });
    }
    
    const updated = await businessTypeService.updateBusinessType(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ 
        ok: false,
        error: 'Business type not found' 
      });
    }
    res.json({ 
      ok: true, 
      data: updated 
    });
  } catch (error) {
    console.error('❌ Error en updateBusinessType:', error);
    res.status(500).json({ 
      ok: false,
      error: error.message 
    });
  }
};

export const deleteBusinessType = async (req, res) => {
  try {
    const deleted = await businessTypeService.deleteBusinessType(req.params.id);
    if (!deleted) {
      return res.status(404).json({ 
        ok: false,
        error: 'Business type not found' 
      });
    }
    res.json({ 
      ok: true, 
      message: 'Business type deleted successfully' 
    });
  } catch (error) {
    console.error('❌ Error en deleteBusinessType:', error);
    res.status(500).json({ 
      ok: false,
      error: error.message 
    });
  }
};