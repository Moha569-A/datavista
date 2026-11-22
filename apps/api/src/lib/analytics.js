import { config } from '../config.js';
import { AppError, errors } from './errors.js';

/**
 * Client for the internal Python analytics service.
 * The browser never talks to this service; the Express API is the
 * authorization boundary (TRD §3).
 */
async function post(pathname, body, { timeoutMs = 120_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.analyticsUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': config.analyticsToken,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = payload?.detail || {};
      // A 4xx from the analytics layer is a *user-facing* validation failure
      // (bad file structure, incompatible field, unsuitable series). Surface it
      // as such rather than masking it as an infrastructure error, so import
      // jobs store an actionable code and message.
      if (res.status >= 400 && res.status < 500) {
        throw new AppError(
          422,
          detail.code || 'ANALYTICS_VALIDATION_FAILED',
          detail.message || 'The request could not be processed.',
          detail.details,
        );
      }
      throw errors.upstream(detail.message || 'The analytics service could not complete the request.', {
        code: detail.code || 'ANALYTICS_ERROR',
        upstreamStatus: res.status,
      });
    }
    return payload;
  } catch (err) {
    // Validation errors raised above must reach the route handler unchanged;
    // only genuine transport/timeout failures are rewritten as upstream errors.
    if (err instanceof AppError) throw err;
    if (err.code === 'UPSTREAM_UNAVAILABLE') throw err;
    if (err.name === 'AbortError') {
      throw errors.upstream('The analytics service took too long to respond. Try a smaller request.');
    }
    throw errors.upstream('The analytics service is unavailable. Please try again in a moment.', {
      code: 'ANALYTICS_UNREACHABLE',
    });
  } finally {
    clearTimeout(timer);
  }
}

export const analytics = {
  async health() {
    try {
      const res = await fetch(`${config.analyticsUrl}/health`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch {
      return false;
    }
  },
  profile: (filename, buffer) =>
    post('/profile', { filename, contentBase64: buffer.toString('base64') }, { timeoutMs: 180_000 }),
  query: (payload) => post('/query', payload),
  forecast: (payload) => post('/forecast', payload, { timeoutMs: 180_000 }),
};
