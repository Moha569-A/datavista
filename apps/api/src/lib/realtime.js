import { Server } from 'socket.io';
import { config } from '../config.js';
import { verifySession } from './auth.js';
import { q } from '../db/index.js';

let io = null;

export function getIo() {
  return io;
}

/**
 * Authenticated Socket.IO server.
 *
 * The handshake reuses the HttpOnly session cookie, so a socket is only ever
 * bound to a verified, active user. Each socket joins exactly one room
 * (`user:<id>`); there is no client-controlled room joining, which prevents
 * cross-tenant subscription (TRD §11).
 */
export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: config.clientOrigin === '*' ? true : config.clientOrigin, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie || '';
      const cookies = Object.fromEntries(
        cookieHeader
          .split(';')
          .map((part) => part.trim().split('='))
          .filter((pair) => pair.length === 2),
      );
      const token = cookies[config.sessionCookie];
      if (!token) return next(new Error('UNAUTHORIZED'));
      const payload = verifySession(token);
      if (!payload) return next(new Error('UNAUTHORIZED'));

      const { rows } = await q('SELECT id, role, is_active, token_version FROM users WHERE id = $1', [payload.sub]);
      const user = rows[0];
      if (!user || !user.is_active || user.token_version !== payload.tv) {
        return next(new Error('UNAUTHORIZED'));
      }
      socket.data.userId = user.id;
      socket.data.role = user.role;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.data.userId;
    socket.join(`user:${uid}`);

    // Explicit re-sync hook: clients may ask for current job state after a
    // reconnect instead of trusting missed events.
    socket.on('sync', async (ack) => {
      try {
        const { rows } = await q(
          `SELECT d.id, d.status, d.row_count, d.updated_at
             FROM datasets d WHERE d.user_id = $1 AND d.status IN ('pending','processing')
             ORDER BY d.created_at DESC LIMIT 20`,
          [uid],
        );
        if (typeof ack === 'function') ack({ datasets: rows, serverTime: new Date().toISOString() });
      } catch {
        if (typeof ack === 'function') ack({ datasets: [] });
      }
    });
  });

  return io;
}

export function closeRealtime() {
  return new Promise((resolve) => {
    if (!io) return resolve();
    io.close(() => {
      io = null;
      resolve();
    });
  });
}
