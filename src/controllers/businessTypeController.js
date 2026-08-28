import * as businessTypeService from '../services/businessTypeService.js';

export const getAllBusinessTypes = async (req, res) => {
  try {
    const businessTypes = await businessTypeService.getAllBusinessTypes();
    res.json(businessTypes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getBusinessTypeById = async (req, res) => {
  try {
    const businessType = await businessTypeService.getBusinessTypeById(req.params.id);
    if (!businessType) return res.status(404).json({ error: 'Business type not found' });
    res.json(businessType);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createBusinessType = async (req, res) => {
  try {
    const newBusinessType = await businessTypeService.createBusinessType(req.body);
    res.status(201).json(newBusinessType);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateBusinessType = async (req, res) => {
  try {
    const updated = await businessTypeService.updateBusinessType(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Business type not found' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteBusinessType = async (req, res) => {
  try {
    const deleted = await businessTypeService.deleteBusinessType(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Business type not found' });
    res.json({ message: 'Business type deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
