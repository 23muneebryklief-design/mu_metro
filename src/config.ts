import { z } from 'zod';

export interface Config {
  nodeEnv: string;
  host: string;
  port: number;
  databasePath: string;
  jwtSecret: string;
  corsOrigins: string[];
  holdMinutes: number;
  demoPayments: boolean;
  clock: () => number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const input = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_PATH: z.string().min(1).default('./data/mu-metro.db'),
    JWT_SECRET: z.string().min(32),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    HOLD_MINUTES: z.coerce.number().int().min(1).max(20).default(10),
    DEMO_PAYMENTS: z.enum(['true', 'false']).default('false'),
  }).parse(env);
  if (/replace-with|change.?me|example-secret/i.test(input.JWT_SECRET)) {
    throw new Error('JWT_SECRET must be a unique randomly generated secret; replace the example value.');
  }
  const corsOrigins = input.CORS_ORIGINS.split(',').map(x => x.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    const parsed = new URL(origin);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins without paths.');
    }
  }
  return {
    nodeEnv: input.NODE_ENV, host: input.HOST, port: input.PORT,
    databasePath: input.DATABASE_PATH, jwtSecret: input.JWT_SECRET, corsOrigins,
    holdMinutes: input.HOLD_MINUTES, demoPayments: input.DEMO_PAYMENTS === 'true', clock: Date.now,
  };
}
