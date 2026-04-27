import * as FeatureModel from '../models/FeatureModel.js';

export const getAllFeatures = () => FeatureModel.findAllFeatures();
export const getFeatureById = (id) => FeatureModel.findFeatureById(id);
export const createFeature = (data) => FeatureModel.createFeature(data);
export const updateFeature = (id, data) => FeatureModel.updateFeature(id, data);
export const deleteFeature = (id) => FeatureModel.deleteFeature(id);
