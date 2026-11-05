import type { Database } from './db.js';
import type { Config } from './config.js';
import type { FastifyRequest } from 'fastify';

export interface Context { db: Database; config: Config }
export type UserClaims = { sub: string; email: string; role: 'customer' | 'admin'; tokenVersion: number };
declare module '@fastify/jwt' { interface FastifyJWT { payload: UserClaims; user: UserClaims } }
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireAdmin: (request: FastifyRequest) => Promise<void>;
  }
}
