import * as BusinessTypeModel from '../models/BusinessTypeModel.js';

export const getAllBusinessTypes = () => BusinessTypeModel.findAllBusinessTypes();
export const getBusinessTypeById = (id) => BusinessTypeModel.findBusinessTypeById(id);
export const createBusinessType = (data) => BusinessTypeModel.createBusinessType(data);
export const updateBusinessType = (id, data) => BusinessTypeModel.updateBusinessType(id, data);
export const deleteBusinessType = (id) => BusinessTypeModel.deleteBusinessType(id);
