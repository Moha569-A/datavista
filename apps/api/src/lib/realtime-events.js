import { getIo } from './realtime.js';
import { notify } from './audit.js';

/**
 * Realtime emissions. Events are scoped to per-user rooms so a socket can only
 * ever receive data for the authenticated user (TRD §7, §11).
 *
 * Socket events are *hints*: clients that reconnect must re-read authoritative
 * state from the REST API (AppFlow §8).
 */
export function userRoom(userId) {
  return `user:${userId}`;
}

export function emitToUser(userId, event, payload, alsoPersist = true) {
  const io = getIo();
  if (io) io.to(userRoom(userId)).emit(event, payload);
  if (alsoPersist) {
    const map = {
      'dataset:processing': ['info', 'Dataset processing started'],
      'dataset:ready': ['success', 'Dataset ready'],
      'dataset:failed': ['error', 'Dataset import failed'],
      'dashboard:refresh': ['info', 'Dashboard refreshed'],
      'forecast:ready': ['success', 'Forecast ready'],
      'forecast:failed': ['error', 'Forecast failed'],
    };
    const [type, title] = map[event] || ['info', event];
    notify(userId, { type, title, message: payload.message || title, link: payload.link || null }).catch(() => {});
  }
}

export function emitDashboardRefresh(dashboardId, userIds, reason) {
  const io = getIo();
  const payload = { dashboardId, reason, updatedAt: new Date().toISOString() };
  for (const uid of new Set(userIds.filter(Boolean))) {
    if (io) io.to(userRoom(uid)).emit('dashboard:refresh', payload);
  }
}
