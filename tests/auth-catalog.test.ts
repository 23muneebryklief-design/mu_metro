import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { loadConfig } from '../src/config.js';

test('registration hashes passwords, normalizes email, and login rejects incorrect credentials', async t => {
  const f = await fixture(); t.after(f.close);
  const payload = { name: 'Test Customer', email: 'Customer@Example.test', password: 'Long unique passphrase 2026!' };
  const created = await f.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
  assert.equal(created.statusCode, 201, created.body);
  const account = created.json().data;
  assert.equal(account.user.email, 'customer@example.test');
  assert.equal(account.user.role, 'customer');
  assert.equal(account.expiresIn, 900);
  assert.ok(account.accessToken);
  assert.ok(!created.body.includes(payload.password));
  assert.ok(!created.body.includes('passwordHash'));
  const saved = f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(account.user.id)!;
  assert.ok(String(saved.password_hash).startsWith('scrypt$'));
  assert.notEqual(saved.password_hash, payload.password);
  const login = await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: payload.email, password: payload.password } });
  assert.equal(login.statusCode, 200, login.body);
  const bad = await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: payload.email, password: 'incorrect-password' } });
  const absent = await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'absent@example.test', password: 'incorrect-password' } });
  assert.equal(bad.statusCode, 401);
  assert.deepEqual(bad.json().error, absent.json().error);
  const duplicate = await f.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { ...payload, email: payload.email.toLowerCase() } });
  assert.equal(duplicate.statusCode, 409, duplicate.body);
});

test('customers cannot elevate their role through registration or use admin APIs', async t => {
  const f = await fixture(); t.after(f.close);
  const attack = await f.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'elevate@example.test', name: 'A', password: 'Long unique passphrase!', role: 'admin' } });
  assert.equal(attack.statusCode, 400, attack.body);
  const result = await f.app.inject({ method: 'PATCH', url: '/api/v1/admin/movies/movie-1', headers: f.auth(), payload: { title: 'Unauthorized edit' } });
  assert.equal(result.statusCode, 403, result.body);
  assert.equal(f.db.prepare("SELECT title FROM movies WHERE id='movie-1'").get()!.title, 'Demo film');
});

test('logout revokes all issued tokens and admin role is checked against the current database', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/me', headers: f.auth() })).statusCode, 200);
  assert.ok([200, 204].includes((await f.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: f.auth() })).statusCode));
  assert.equal((await f.app.inject({ url: '/api/v1/auth/me', headers: f.auth() })).statusCode, 401);
  f.db.prepare("UPDATE users SET role='customer' WHERE id='admin'").run();
  assert.equal((await f.app.inject({ method: 'PATCH', url: '/api/v1/admin/movies/movie-1', headers: f.auth('admin'), payload: { title: 'A' } })).statusCode, 403);
});

test('draft movies and inactive cinemas are hidden and query input is bounded', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.app.inject('/api/v1/movies?limit=101')).statusCode, 400);
  assert.equal((await f.app.inject('/api/v1/screenings?date=2026-02-30')).statusCode, 400);
  assert.equal((await f.app.inject('/api/v1/movies?search=%27%20OR%201%3D1--')).statusCode, 200);
  const injection = await f.app.inject('/api/v1/movies?search=%27%20OR%201%3D1--');
  assert.equal(injection.json().data.length, 0);
  f.db.prepare("UPDATE movies SET status='draft' WHERE id='movie-1'").run();
  assert.equal((await f.app.inject('/api/v1/movies/movie-1')).statusCode, 404);
  assert.equal((await f.app.inject('/api/v1/movies')).json().data.length, 0);
  assert.equal((await f.app.inject('/api/v1/screenings')).json().data.length, 0);
  f.db.prepare("UPDATE cinemas SET active=0 WHERE id='cinema-1'").run();
  assert.equal((await f.app.inject('/api/v1/cinemas/cinema-1')).statusCode, 404);
});

test('screenings reject overlaps, allow the precise 20-minute turnaround, and reject missing parents', async t => {
  const f = await fixture(); t.after(f.close);
  const existing = f.db.prepare("SELECT * FROM screenings WHERE id='screen-1'").get()!;
  const payload = { movieId: 'movie-1', auditoriumId: 'aud-1', startsAt: existing.starts_at, priceCents: 15000 };
  const call = (body: object) => f.app.inject({ method: 'POST', url: '/api/v1/admin/screenings', headers: f.auth('admin'), payload: body });
  assert.equal((await call(payload)).statusCode, 409);
  const start = new Date(Date.parse(String(existing.ends_at)) + 20 * 60_000).toISOString();
  assert.equal((await call({ ...payload, startsAt: start })).statusCode, 201);
  assert.equal((await call({ ...payload, auditoriumId: 'nonexistent' })).statusCode, 404);
});

test('live holds block price changes, runtime changes, and cinema deactivation; cancelling show frees holds', async t => {
  const f = await fixture(); t.after(f.close);
  await f.hold();
  const patch = (url: string, payload: object) => f.app.inject({ method: 'PATCH', url, headers: f.auth('admin'), payload });
  assert.equal((await patch('/api/v1/admin/screenings/screen-1', { priceCents: 1 })).statusCode, 409);
  assert.equal((await patch('/api/v1/admin/movies/movie-1', { durationMinutes: 180 })).statusCode, 409);
  assert.equal((await patch('/api/v1/admin/cinemas/cinema-1', { active: false })).statusCode, 409);
  assert.equal((await patch('/api/v1/admin/screenings/screen-1', { status: 'cancelled' })).statusCode, 200);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM seat_claims').get()!.count, 0);
});

test('confirmed bookings prevent silent show cancellation', async t => {
  const f = await fixture(); t.after(f.close);
  const held = (await f.hold()).json().data;
  const booked = (await f.booking(held.id)).json().data;
  const payment = await f.app.inject({ method: 'POST', url: `/api/v1/bookings/${booked.id}/demo-payment`, headers: f.auth('alice', 'pay') });
  assert.equal(payment.statusCode, 200, payment.body);
  const cancel = await f.app.inject({ method: 'PATCH', url: '/api/v1/admin/screenings/screen-1', headers: f.auth('admin'), payload: { status: 'cancelled' } });
  assert.equal(cancel.statusCode, 409, cancel.body);
  const customerCancel = await f.app.inject({ method: 'DELETE', url: `/api/v1/bookings/${booked.id}`, headers: f.auth() });
  assert.equal(customerCancel.statusCode, 409, customerCancel.body);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM seat_claims').get()!.count, 1);
});

test('cinema-day filters use South African midnight rather than UTC midnight', async t => {
  const f = await fixture(); t.after(f.close);
  const start = new Date(f.config.clock() + 7 * 86_400_000);
  start.setUTCHours(22, 30, 0, 0);
  f.db.prepare("UPDATE screenings SET starts_at=?, ends_at=? WHERE id='screen-1'").run(start.toISOString(), new Date(start.getTime() + 7_200_000).toISOString());
  const localDate = new Date(start.getTime() + 7_200_000).toISOString().slice(0, 10);
  const local = await f.app.inject(`/api/v1/screenings?date=${localDate}`);
  const previous = await f.app.inject(`/api/v1/screenings?date=${start.toISOString().slice(0, 10)}`);
  assert.equal(local.json().data.length, 1, local.body);
  assert.equal(previous.json().data.length, 0, previous.body);
});

test('OpenAPI documents booking and auth routes, health and errors do not expose internals', async t => {
  const f = await fixture(); t.after(f.close);
  const docs = await f.app.inject('/docs/json');
  assert.equal(docs.statusCode, 200, docs.body);
  assert.ok(docs.json().paths['/api/v1/bookings']);
  assert.ok(docs.json().paths['/api/v1/auth/login']);
  assert.equal((await f.app.inject('/health')).statusCode, 200);
  const absent = await f.app.inject('/not-a-route');
  assert.equal(absent.statusCode, 404);
  assert.ok(absent.json().requestId);
  assert.ok(!absent.body.includes('stack'));
  const cors = await f.app.inject({ method: 'OPTIONS', url: '/api/v1/movies', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  assert.equal(cors.headers['access-control-allow-origin'], undefined);
});

test('configuration fails closed for missing or example JWT secrets and invalid demo setting', () => {
  assert.throws(() => loadConfig({}));
  assert.throws(() => loadConfig({ JWT_SECRET: 'replace-with-a-random-secret-of-at-least-32-characters' }));
  assert.throws(() => loadConfig({ JWT_SECRET: 'a'.repeat(48), DEMO_PAYMENTS: 'yes' }));
  assert.equal(loadConfig({ JWT_SECRET: 'a'.repeat(48) }).demoPayments, false);
});

test('unrelated PATCH fields preserve inactive cinema and cancelled screening status', async t => {
  const f = await fixture(); t.after(f.close);
  f.db.prepare("UPDATE screenings SET status='cancelled' WHERE id='screen-1'").run();
  f.db.prepare("UPDATE cinemas SET active=0 WHERE id='cinema-1'").run();
  const rename = await f.app.inject({ method: 'PATCH', url: '/api/v1/admin/cinemas/cinema-1', headers: f.auth('admin'), payload: { name: 'Renamed cinema' } });
  assert.equal(rename.statusCode, 200, rename.body);
  assert.equal(rename.json().data.active, false);
  const price = await f.app.inject({ method: 'PATCH', url: '/api/v1/admin/screenings/screen-1', headers: f.auth('admin'), payload: { priceCents: 15000 } });
  assert.equal(price.statusCode, 200, price.body);
  assert.equal(price.json().data.status, 'cancelled');
});
