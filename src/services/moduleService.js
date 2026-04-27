import * as ModuleModel from '../models/ModuleModel.js';

export const getAllModules = () => ModuleModel.findAllModules();
export const getModuleById = (id) => ModuleModel.findModuleById(id);
export const createModule = (data) => ModuleModel.createModule(data);
export const updateModule = (id, data) => ModuleModel.updateModule(id, data);
export const deleteModule = (id) => ModuleModel.deleteModule(id);
