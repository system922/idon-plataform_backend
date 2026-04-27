import { createServer } from 'http';
import app from './app.js';
import pool from './config/database.js';
import env from './config/env.js';
import logger from './utils/logger.js';
import { migrateControlPlane } from './db/migrate.js';
import { init as initWhatsapp } from './services/whatsappService.js';
import { startQueueFlusher } from './utils/waNotifications.js';
import { initSocket } from './socket.js';

const PORT = env.port;

const startServer = async () => {
  try {
    // Test database connection
    const result = await pool.query('SELECT NOW()');
    logger.info('Database connection successful');

    // Run control-plane migrations
    logger.info('Running control-plane migrations...');
    await migrateControlPlane();
    logger.info('Control-plane migrations completed');

    // Attach Socket.io to the HTTP server
    const httpServer = createServer(app);
    initSocket(httpServer);

    // Start server
    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${env.environment}`);
      logger.info(`CORS allowed origins: ${env.corsOrigin.join(', ')}`);
      // WhatsApp: solo iniciar si está habilitado (requiere Chrome/Puppeteer)
      if (env.whatsappEnabled) {
        logger.info('WhatsApp habilitado — iniciando...');
        initWhatsapp();
        startQueueFlusher();
      } else {
        logger.info('WhatsApp deshabilitado (WHATSAPP_ENABLED != true) — skipping');
      }
      // Keep-alive ping para evitar que Render (free tier) duerma el servicio
      if (env.environment === 'production' && process.env.RENDER_EXTERNAL_URL) {
        const pingUrl = `${process.env.RENDER_EXTERNAL_URL}/health`;
        setInterval(() => {
          fetch(pingUrl).catch(() => {});
        }, 14 * 60 * 1000); // cada 14 min
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    console.error(error);
    process.exit(1);
  }
};

// Evitar que errores no capturados de WhatsApp/Puppeteer tumben el servidor
process.on('uncaughtException', (err) => {
  logger.error({ err: err.message }, '[PROCESS] uncaughtException — servidor sigue corriendo');
  console.error('[PROCESS] uncaughtException:', err.message);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error({ err: msg }, '[PROCESS] unhandledRejection — servidor sigue corriendo');
  console.error('[PROCESS] unhandledRejection:', msg);
});

process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

startServer();
