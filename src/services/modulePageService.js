import * as ModulePageModel from '../models/ModulePageModel.js';

export const getAllModulePages = () => ModulePageModel.findAllModulePages();
export const getModulePageById = (id) => ModulePageModel.findModulePageById(id);
export const createModulePage = (data) => ModulePageModel.createModulePage(data);
export const updateModulePage = (id, data) => ModulePageModel.updateModulePage(id, data);
export const deleteModulePage = (id) => ModulePageModel.deleteModulePage(id);
