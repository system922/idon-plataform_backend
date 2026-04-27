import * as billingHistoryService from '../services/billingHistoryService.js';
export const listBillingHistory = async (req, res) => {
  try {
    const rows = await billingHistoryService.getList();
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};