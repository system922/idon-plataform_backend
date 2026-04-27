/**
 * socket.js — Singleton de Socket.io
 *
 * Rooms: `business:{businessId}`  (una room por negocio)
 *
 * Flujo de autenticación del cliente:
 *   1. connect con query  ?token=<JWT>&businessId=<id>
 *   2. El servidor valida el token y mete al cliente en la room del negocio
 *   3. El servidor emite eventos dentro de esa room
 *
 * Eventos que el servidor emite:
 *   new_order      → { pedido, items, schema }
 *   order_updated  → { id, status, schema }
 */

import { Server } from 'socket.io';
import { verifyToken } from './services/authService.js';
import env from './config/env.js';
import logger from './utils/logger.js';

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    try {
      const token      = socket.handshake.auth?.token      || socket.handshake.query?.token;
      const businessId = socket.handshake.auth?.businessId || socket.handshake.query?.businessId;

      if (!token) return next(new Error('Token requerido'));

      const decoded = verifyToken(token);
      socket.user       = decoded;
      socket.businessId = businessId || decoded.businessId;

      if (!socket.businessId) return next(new Error('businessId requerido'));

      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    const room = `business:${socket.businessId}`;
    socket.join(room);
    logger.info(`[SOCKET] Cliente conectado — room: ${room}  id: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      logger.info(`[SOCKET] Cliente desconectado — ${socket.id}  reason: ${reason}`);
    });
  });

  logger.info('[SOCKET] Socket.io inicializado');
  return io;
}

/** Devuelve la instancia (null si aún no se inicializó) */
export function getIO() {
  return io;
}

/**
 * Emite un evento a todos los clientes conectados de un negocio.
 * @param {string} businessId
 * @param {string} event
 * @param {object} payload
 */
export function emitToBusiness(businessId, event, payload) {
  if (!io) return;
  io.to(`business:${businessId}`).emit(event, payload);
}
