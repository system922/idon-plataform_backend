import * as featureService from '../services/featureService.js';

export const getAllFeatures = async (req, res) => {
  try {
    const features = await featureService.getAllFeatures();
    res.json(features);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getFeatureById = async (req, res) => {
  try {
    const feature = await featureService.getFeatureById(req.params.id);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    res.json(feature);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createFeature = async (req, res) => {
  try {
    const newFeature = await featureService.createFeature(req.body);
    res.status(201).json(newFeature);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateFeature = async (req, res) => {
  try {
    const updated = await featureService.updateFeature(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Feature not found' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteFeature = async (req, res) => {
  try {
    const deleted = await featureService.deleteFeature(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Feature not found' });
    res.json({ message: 'Feature deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
