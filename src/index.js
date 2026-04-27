import app from './app.js';
import pool from './config/database.js';
import env from './config/env.js';
import logger from './utils/logger.js';
import { migrateControlPlane } from './db/migrate.js';
import { init as initWhatsapp } from './services/whatsappService.js';
import { startQueueFlusher } from './utils/waNotifications.js';

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

    // Start server
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${env.environment}`);
      // WhatsApp: iniciar en background (no bloquea el arranque)
      initWhatsapp();
      startQueueFlusher();
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
