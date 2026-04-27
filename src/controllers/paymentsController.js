import * as paymentsAdminService from '../services/paymentsAdminService.js';

export const getAdminPayments = async (req, res) => {
  try {
    const payments = await paymentsAdminService.getAllAdminPayments();
    res.json({ data: payments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
