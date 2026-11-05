import { randomBytes } from 'node:crypto';
import { openDatabase, migrate } from '../src/db.js';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

export async function fixture(options: { path?: string; demoPayments?: boolean } = {}) {
  let now = Date.now();
  const config: Config = {
    nodeEnv: 'test', host: '127.0.0.1', port: 3000, databasePath: options.path ?? ':memory:',
    jwtSecret: randomBytes(48).toString('hex'), corsOrigins: ['http://localhost:5173'],
    holdMinutes: 10, demoPayments: options.demoPayments ?? true, clock: () => now,
  };
  const db = openDatabase(config.databasePath);
  migrate(db);
  const created = new Date(now).toISOString();
  for (const [id, role] of [['alice', 'customer'], ['bob', 'customer'], ['admin', 'admin']]) {
    db.prepare('INSERT OR IGNORE INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, `${id}@example.test`, 'unused-test-hash', id, role, created);
  }
  db.prepare('INSERT OR IGNORE INTO movies VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('movie-1', 'demo-film', 'Demo film', 'Fictional movie', 120, '13', 'Adventure', null, 'now_showing', '2026-01-01', created);
  db.prepare('INSERT OR IGNORE INTO cinemas VALUES (?,?,?,?,?,?,?)')
    .run('cinema-1', 'demo-cinema', 'Demo cinema', 'Cape Town', 'Demo address', 'Africa/Johannesburg', 1);
  db.prepare('INSERT OR IGNORE INTO auditoriums VALUES (?,?,?,?)').run('aud-1', 'cinema-1', 'Screen 1', '2D');
  db.prepare('INSERT OR IGNORE INTO auditoriums VALUES (?,?,?,?)').run('aud-2', 'cinema-1', 'Screen 2', '3D');
  for (let n = 1; n <= 12; n++) db.prepare('INSERT OR IGNORE INTO seats VALUES (?,?,?,?,?)').run(`seat-${n}`, 'aud-1', 'A', n, 'standard');
  db.prepare('INSERT OR IGNORE INTO seats VALUES (?,?,?,?,?)').run('other-seat', 'aud-2', 'A', 1, 'standard');
  db.prepare('INSERT OR IGNORE INTO screenings VALUES (?,?,?,?,?,?,?)')
    .run('screen-1', 'movie-1', 'aud-1', new Date(now + 86_400_000).toISOString(), new Date(now + 93_600_000).toISOString(), 12500, 'scheduled');
  const app = await buildApp(config, { db, logger: false, rateLimit: false });
  const tokens = Object.fromEntries(['alice', 'bob', 'admin'].map(id => [id, app.jwt.sign({ sub: id, email: `${id}@example.test`, role: id === 'admin' ? 'admin' : 'customer', tokenVersion: 0 })]));
  function auth(id = 'alice', key?: string) {
    return { authorization: `Bearer ${tokens[id]}`, ...(key ? { 'idempotency-key': key } : {}) };
  }
  async function hold(seatIds = ['seat-1'], id = 'alice', key = 'hold-default') {
    return app.inject({ method: 'POST', url: '/api/v1/holds', headers: auth(id, key), payload: { screeningId: 'screen-1', seatIds } });
  }
  async function booking(holdId: string, id = 'alice', key = 'booking-default') {
    return app.inject({ method: 'POST', url: '/api/v1/bookings', headers: auth(id, key), payload: { holdId } });
  }
  async function close() { await app.close(); db.close(); }
  return { app, db, config, auth, hold, booking, close, advance: (ms: number) => { now += ms; } };
}
