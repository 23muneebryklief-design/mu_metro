import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { ApiError } from './lib/errors.js';
import { openDatabase, migrate, type Database } from './db.js';
import type { Config } from './config.js';
import { registerAuth } from './routes/auth.js';
import { registerCatalog } from './routes/catalog.js';
import { registerBookings } from './routes/bookings.js';

export async function buildApp(config: Config, options: { db?: Database; logger?: boolean; rateLimit?: boolean; frontendRoot?: string | false } = {}) {
  const db = options.db ?? openDatabase(config.databasePath);
  migrate(db);
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: config.nodeEnv === 'test' ? 'silent' : 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', 'password', 'passwordHash', 'accessToken'],
    },
    bodyLimit: 32 * 1024,
    trustProxy: false,
    requestTimeout: 15_000,
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.addHook('onClose', async () => { if (!options.db) db.close(); });
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: false,
  });
  await app.register(rateLimit, { global: options.rateLimit !== false, max: 120, timeWindow: '1 minute' });
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: '15m', iss: 'mu-metro-api', aud: 'mu-metro-client' },
    verify: { algorithms: ['HS256'], allowedIss: 'mu-metro-api', allowedAud: 'mu-metro-client' },
  });
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'Mu Metro cinema backend', version: '1.0.0', description: 'Independent redesign backend. Sample inventory and demo payments; no connection to Nu Metro live systems. All money is integer ZAR cents. All timestamps are ISO 8601 UTC.' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      tags: ['Auth', 'Movies', 'Cinemas', 'Screenings', 'Admin', 'Bookings', 'Holds', 'System'].map(name => ({ name })),
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.issues.map(issue => ({ path: issue.path, message: issue.message })) }, requestId: request.id });
    }
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) }, requestId: request.id });
    }
    const known = error as { code?: string; statusCode?: number; validation?: unknown; message?: string };
    if (known.validation) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' }, requestId: request.id });
    if (known.code?.startsWith('FST_JWT') || known.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'A valid access token is required' }, requestId: request.id });
    }
    if (known.code?.startsWith('SQLITE_CONSTRAINT') || (known.code === 'ERR_SQLITE_ERROR' && /constraint failed/i.test(known.message ?? ''))) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'This operation conflicts with an existing record' }, requestId: request.id });
    }
    if (known.statusCode && known.statusCode >= 400 && known.statusCode < 500) {
      return reply.code(known.statusCode).send({ error: { code: known.statusCode === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST', message: known.statusCode === 429 ? 'Too many requests. Please try again later.' : 'The request could not be processed' }, requestId: request.id });
    }
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' }, requestId: request.id }));
  app.get('/health', { schema: { tags: ['System'], summary: 'Database readiness check' } }, async (_req, reply) => {
    try { db.prepare('SELECT 1').get(); return { status: 'ok' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.get('/api/v1', { schema: { tags: ['System'], summary: 'API capabilities and payment mode' } }, async () => ({
    name: 'Mu Metro API', version: '1.0.0', currency: 'ZAR', timezone: 'Africa/Johannesburg',
    paymentMode: config.demoPayments ? 'demo' : 'unconfigured', docs: '/docs',
    disclaimer: 'Independent development project. No live Nu Metro inventory or real ticket issuance.',
  }));
  const ctx = { db, config };
  await registerAuth(app, ctx);
  await registerCatalog(app, ctx);
  await registerBookings(app, ctx);
  const frontendRoot = options.frontendRoot === false ? null : options.frontendRoot ?? (config.nodeEnv === 'test' ? null : resolve('frontend/dist'));
  if (frontendRoot && existsSync(resolve(frontendRoot, 'index.html'))) {
    // Hash-based frontend routes all resolve to /. Unknown API paths retain JSON 404 responses.
    await app.register(fastifyStatic, { root: frontendRoot, wildcard: false });
  }
  await app.ready();
  return app;
}
