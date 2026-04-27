/**
 * routes/whatsapp.js
 * GET  /api/whatsapp/status  — estado y QR actual
 * POST /api/whatsapp/restart — reiniciar sesión (logout + re-init)
 */
import express from 'express';
import { getStatus, init, logout, resetReconnectCounter } from '../services/whatsappService.js';
import { getQueueStatus, flushQueue } from '../utils/waNotifications.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.get('/status', authMiddleware, (req, res) => {
  res.json({ ...getStatus(), queue: getQueueStatus() });
});

router.post('/flush-queue', authMiddleware, async (req, res) => {
  await flushQueue();
  res.json({ ok: true, queue: getQueueStatus() });
});

router.post('/restart', authMiddleware, async (req, res) => {
  await logout().catch(() => {});
  resetReconnectCounter();
  init();
  res.json({ ok: true, message: 'Reiniciando WhatsApp...' });
});

router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await logout();
    res.json({ ok: true, message: 'Sesión cerrada' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
