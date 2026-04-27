import * as fiscalConfigService from '../services/fiscalConfigService.js';

export const getFiscalConfig = async (req, res) => {
  try {
    const cfg = await fiscalConfigService.getFiscalConfig();
    res.json({ data: cfg });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const updateFiscalConfig = async (req, res) => {
  try {
    const updated = await fiscalConfigService.updateFiscalConfig(req.body);
    res.json({ data: updated, message: 'Configuración fiscal actualizada' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};