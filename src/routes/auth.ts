import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Context, UserClaims } from '../types.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

type UserRow = { id: string; email: string; name: string; role: 'customer' | 'admin'; password_hash: string; token_version: number; created_at: string };
const email = z.string().trim().email().max(254).transform(value => value.toLowerCase());
const registerBody = z.object({ email, name: z.string().trim().min(1).max(100), password: z.string().min(12).max(128) }).strict();
const loginBody = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const publicUser = (row: UserRow) => ({ id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at });

export async function registerAuth(app: FastifyInstance, { db, config }: Context) {
  const dummyHash = await hashPassword('not-an-account-password');
  app.decorate('authenticate', async (request: FastifyRequest) => {
    try { await request.jwtVerify(); } catch { throw new ApiError(401, 'UNAUTHORIZED', 'A valid bearer token is required.'); }
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.sub) as UserRow | undefined;
    if (!row || row.token_version !== request.user.tokenVersion) throw new ApiError(401, 'UNAUTHORIZED', 'Your session is no longer valid. Please sign in again.');
    request.user = { sub: row.id, email: row.email, role: row.role, tokenVersion: row.token_version };
  });
  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    await app.authenticate(request);
    if (request.user.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access is required.');
  });
  const session = (row: UserRow) => {
    const claims: UserClaims = { sub: row.id, email: row.email, role: row.role, tokenVersion: row.token_version };
    return { data: { user: publicUser(row), accessToken: app.jwt.sign(claims, { expiresIn: '15m' }), tokenType: 'Bearer', expiresIn: 900 } };
  };
  const registerSchema = {
    tags: ['Authentication'], summary: 'Register a customer account',
    body: { type: 'object', additionalProperties: false, required: ['email', 'name', 'password'], properties: {
      email: { type: 'string', format: 'email', maxLength: 254 }, name: { type: 'string', minLength: 1, maxLength: 100 }, password: { type: 'string', minLength: 12, maxLength: 128 },
    } },
  };
  app.post('/api/v1/auth/register', { schema: registerSchema, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = registerBody.parse(request.body);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) throw new ApiError(409, 'EMAIL_IN_USE', 'An account already exists for that email.');
    const passwordHash = await hashPassword(body.password);
    const id = randomUUID();
    try {
      db.prepare('INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)').run(id, body.email, passwordHash, body.name, 'customer', new Date(config.clock()).toISOString());
    } catch (error) {
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) throw new ApiError(409, 'EMAIL_IN_USE', 'An account already exists for that email.');
      throw error;
    }
    return reply.code(201).send(session(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow));
  });
  app.post('/api/v1/auth/login', { schema: { tags: ['Authentication'], summary: 'Sign in and receive a 15-minute bearer token', body: {
    type: 'object', additionalProperties: false, required: ['email', 'password'], properties: { email: { type: 'string', maxLength: 254 }, password: { type: 'string', minLength: 1, maxLength: 128 } },
  } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async request => {
    const body = loginBody.parse(request.body);
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email) as UserRow | undefined;
    const valid = await verifyPassword(body.password, row?.password_hash ?? dummyHash);
    if (!row || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    return session(row);
  });
  app.get('/api/v1/auth/me', { preHandler: app.authenticate, schema: { tags: ['Authentication'], summary: 'Get your account', security: [{ bearerAuth: [] }] } }, async request => {
    return { data: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.sub) as UserRow) };
  });
  app.post('/api/v1/auth/logout', { preHandler: app.authenticate, schema: { tags: ['Authentication'], summary: 'Revoke all current sessions for your account', security: [{ bearerAuth: [] }] } }, async request => {
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(request.user.sub);
    return { data: { message: 'All sessions have been revoked.' } };
  });
}
