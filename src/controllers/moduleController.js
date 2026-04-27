import * as moduleService from '../services/moduleService.js';

export const getAllModules = async (req, res) => {
  try {
    const modules = await moduleService.getAllModules();
    res.json(modules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getModuleById = async (req, res) => {
  try {
    const module = await moduleService.getModuleById(req.params.id);
    if (!module) return res.status(404).json({ error: 'Module not found' });
    res.json(module);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createModule = async (req, res) => {
  try {
    const newModule = await moduleService.createModule(req.body);
    res.status(201).json(newModule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateModule = async (req, res) => {
  try {
    const updated = await moduleService.updateModule(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Module not found' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteModule = async (req, res) => {
  try {
    const deleted = await moduleService.deleteModule(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Module not found' });
    res.json({ message: 'Module deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
