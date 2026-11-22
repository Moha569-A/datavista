/**
 * Consistent error contract (TRD §6): every failure returns
 *   { error: { code, message, details? , requestId } }
 * Internal errors never leak stack traces or SQL to the client.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
  }
}

export const errors = {
  badRequest: (message, details) => new AppError(400, 'BAD_REQUEST', message, details),
  validation: (message, fieldErrors) =>
    new AppError(422, 'VALIDATION_ERROR', message, { fields: fieldErrors }),
  unauthorized: (message = 'Authentication required.') =>
    new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have permission to perform this action.') =>
    new AppError(403, 'FORBIDDEN', message),
  // Non-disclosing 404 for resources the caller may not see (AppFlow §10).
  notFound: (message = 'Resource not found.') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message, details) => new AppError(409, 'CONFLICT', message, details),
  tooMany: (message = 'Too many requests. Please try again shortly.') =>
    new AppError(429, 'RATE_LIMITED', message),
  internal: (message = 'Something went wrong on our side.') =>
    new AppError(500, 'INTERNAL_ERROR', message),
  upstream: (message, details) => new AppError(502, 'UPSTREAM_UNAVAILABLE', message, details),
};

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.path}.`, requestId: req.id },
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const isApp = err instanceof AppError;
  const status = isApp ? err.status : err.status || 500;

  if (!isApp) {
    console.error(`[error] ${req.method} ${req.path}`, err);
  }

  const payload = {
    error: {
      code: isApp ? err.code : 'INTERNAL_ERROR',
      message: isApp && err.expose ? err.message : 'Something went wrong on our side.',
      requestId: req.id,
    },
  };
  if (isApp && err.details) payload.error.details = err.details;

  if (res.headersSent) return;
  res.status(status).json(payload);
}

/** Wrap async route handlers so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
