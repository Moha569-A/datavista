import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler, notFoundHandler, errors } from './lib/errors.js';
import { csrfProtection, loadUserFromCookie } from './lib/auth.js';
import { analytics } from './lib/analytics.js';
import authRoutes from './routes/auth.js';
import datasetRoutes from './routes/datasets.js';
import chartRoutes from './routes/charts.js';
import dashboardRoutes from './routes/dashboards.js';
import analyticsRoutes from './routes/analytics.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';

export function createApp() {
  const app = express();

  // Behind a proxy/load balancer in production: trust one hop so rate limiting
  // and secure cookies see the real client protocol.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // API only serves JSON; the SPA is served by Vite/static host
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: config.clientOrigin === '*' ? true : config.clientOrigin.split(','),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(cookieParser());

  // Request correlation id for support and log tracing.
  app.use((req, res, next) => {
    req.id = req.get('x-request-id') || crypto.randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });

  if (config.env !== 'test') {
    morgan.token('id', (req) => req.id);
    app.use(morgan(':method :url :status :response-time ms req=:id'));
  }

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: config.apiRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(errors.tooMany()),
  });

  app.get('/health', async (_req, res) => {
    const analyticsOk = await analytics.health();
    res.status(analyticsOk ? 200 : 200).json({
      status: 'ok',
      service: 'api',
      version: '1.0.0',
      dependencies: { analytics: analyticsOk ? 'up' : 'down' },
      time: new Date().toISOString(),
    });
  });

  const api = express.Router();
  api.use(apiLimiter);
  api.use(loadUserFromCookie);

  // CSRF applies to cookie-authenticated state changes. GET/HEAD/OPTIONS are
  // unaffected; auth routes are excluded because the cookie is created there.
  api.use((req, res, next) => {
    if (req.path.startsWith('/auth/login') || req.path.startsWith('/auth/register')) return next();
    return csrfProtection(req, res, next);
  });

  api.use('/auth', authRoutes);
  api.use('/datasets', datasetRoutes);
  api.use('/charts', chartRoutes);
  api.use('/dashboards', dashboardRoutes);
  api.use('/analytics', analyticsRoutes);
  api.use('/admin', adminRoutes);
  api.use('/notifications', notificationRoutes);

  app.use(config.apiPrefix, api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
