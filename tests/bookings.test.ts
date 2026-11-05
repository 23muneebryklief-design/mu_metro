import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';

test('one seat can be held by only one customer under competing requests', async t => {
  const f = await fixture(); t.after(f.close);
  const results = await Promise.all([f.hold(['seat-1'], 'alice', 'a'), f.hold(['seat-1'], 'bob', 'b')]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 409]);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM seat_claims').get()!.count, 1);
});

test('multi-seat reservation is atomic when one requested seat is occupied', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.hold()).statusCode, 201);
  assert.equal((await f.hold(['seat-2', 'seat-1'], 'bob', 'bob')).statusCode, 409);
  assert.equal((await f.hold(['seat-2'], 'bob', 'bob-2')).statusCode, 201);
});

test('hold requires authentication, an idempotency key, and a valid unique seat set', async t => {
  const f = await fixture(); t.after(f.close);
  const payload = { screeningId: 'screen-1', seatIds: ['seat-1'] };
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/holds', headers: { 'idempotency-key': 'unauthenticated' }, payload })).statusCode, 401);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/holds', headers: f.auth(), payload })).statusCode, 400);
  assert.equal((await f.hold(['seat-1', 'seat-1'])).statusCode, 400);
  assert.equal((await f.hold(['other-seat'])).statusCode, 400);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM seat_claims').get()!.count, 0);
});

test('idempotency returns one hold and rejects changed payload under the same key', async t => {
  const f = await fixture(); t.after(f.close);
  const first = await f.hold();
  const second = await f.hold();
  assert.equal(first.statusCode, 201);
  assert.equal(second.json().data.id, first.json().data.id);
  assert.equal((await f.hold(['seat-2'])).statusCode, 409);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM holds').get()!.count, 1);
});

test('expired holds free seats and cannot be converted to bookings', async t => {
  const f = await fixture(); t.after(f.close);
  const held = (await f.hold()).json().data;
  f.advance(10 * 60_000 + 1);
  const stale = await f.booking(held.id);
  assert.ok([409, 410].includes(stale.statusCode), stale.body);
  assert.equal((await f.hold(['seat-1'], 'bob', 'after-expiry')).statusCode, 201);
});

test('hold and booking ownership prevents access by another customer', async t => {
  const f = await fixture(); t.after(f.close);
  const held = (await f.hold()).json().data;
  for (const method of ['GET', 'DELETE'] as const) {
    const response = await f.app.inject({ method, url: `/api/v1/holds/${held.id}`, headers: f.auth('bob') });
    assert.ok([403, 404].includes(response.statusCode), response.body);
  }
  assert.ok([403, 404].includes((await f.booking(held.id, 'bob')).statusCode));
  const booked = (await f.booking(held.id)).json().data;
  for (const method of ['GET', 'DELETE'] as const) {
    const response = await f.app.inject({ method, url: `/api/v1/bookings/${booked.id}`, headers: f.auth('bob') });
    assert.ok([403, 404].includes(response.statusCode), response.body);
  }
});

test('server calculates cents; confirming demo payment twice creates one payment and retains seats', async t => {
  const f = await fixture(); t.after(f.close);
  const held = (await f.hold(['seat-1', 'seat-2'])).json().data;
  const response = await f.booking(held.id);
  assert.equal(response.statusCode, 201, response.body);
  const booked = response.json().data;
  assert.equal(booked.totalCents, 25000);
  assert.equal(booked.currency, 'ZAR');
  const url = `/api/v1/bookings/${booked.id}/demo-payment`;
  const payment = await f.app.inject({ method: 'POST', url, headers: f.auth('alice', 'pay-1') });
  assert.equal(payment.statusCode, 200, payment.body);
  assert.equal(payment.json().data.status, 'confirmed');
  const again = await f.app.inject({ method: 'POST', url, headers: f.auth('alice', 'pay-2') });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM payments').get()!.count, 1);
  f.advance(11 * 60_000);
  assert.equal((await f.hold(['seat-1'], 'bob', 'b')).statusCode, 409);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM seat_claims WHERE expires_at IS NULL').get()!.count, 2);
});

test('payment cannot confirm an expired pending booking or acquire a seat owned by someone else', async t => {
  const f = await fixture(); t.after(f.close);
  const held = (await f.hold()).json().data;
  const booked = (await f.booking(held.id)).json().data;
  f.advance(10 * 60_000 + 1);
  assert.equal((await f.hold(['seat-1'], 'bob', 'reclaim')).statusCode, 201);
  const response = await f.app.inject({ method: 'POST', url: `/api/v1/bookings/${booked.id}/demo-payment`, headers: f.auth('alice', 'late') });
  assert.ok([409, 410].includes(response.statusCode), response.body);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM payments').get()!.count, 0);
  assert.equal(f.db.prepare("SELECT h.user_id FROM seat_claims sc JOIN holds h ON h.id=sc.hold_id WHERE sc.seat_id='seat-1'").get()!.user_id, 'bob');
});

test('demo payment is unavailable without explicit opt-in', async t => {
  const f = await fixture({ demoPayments: false }); t.after(f.close);
  const held = (await f.hold()).json().data;
  const booked = (await f.booking(held.id)).json().data;
  const result = await f.app.inject({ method: 'POST', url: `/api/v1/bookings/${booked.id}/demo-payment`, headers: f.auth('alice', 'pay') });
  assert.equal(result.statusCode, 503, result.body);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM payments').get()!.count, 0);
});

test('cancelling a pending booking releases its seat and a payment retry cannot revive it', async t => {
  const f = await fixture(); t.after(f.close);
  const held = (await f.hold()).json().data;
  const booked = (await f.booking(held.id)).json().data;
  const result = await f.app.inject({ method: 'DELETE', url: `/api/v1/bookings/${booked.id}`, headers: f.auth() });
  assert.ok([200, 204].includes(result.statusCode), result.body);
  assert.equal((await f.hold(['seat-1'], 'bob', 'new')).statusCode, 201);
  const pay = await f.app.inject({ method: 'POST', url: `/api/v1/bookings/${booked.id}/demo-payment`, headers: f.auth('alice', 'pay') });
  assert.equal(pay.statusCode, 409, pay.body);
});

test('seat map reports availability without exposing customer identifiers', async t => {
  const f = await fixture(); t.after(f.close);
  await f.hold();
  const response = await f.app.inject('/api/v1/screenings/screen-1/seats');
  assert.equal(response.statusCode, 200, response.body);
  const seats = response.json().data.seats;
  assert.equal(seats.find((s: {seatId: string}) => s.seatId === 'seat-1').status, 'held');
  assert.equal(seats.find((s: {seatId: string}) => s.seatId === 'seat-2').status, 'available');
  assert.ok(!response.body.includes('alice'));
  assert.ok(!response.body.includes('userId'));
});

test('client-supplied prices are rejected and past/cancelled screenings cannot be reserved', async t => {
  const f = await fixture(); t.after(f.close);
  const injected = await f.app.inject({ method: 'POST', url: '/api/v1/holds', headers: f.auth('alice', 'price'), payload: { screeningId: 'screen-1', seatIds: ['seat-1'], priceCents: 1 } });
  assert.equal(injected.statusCode, 400, injected.body);
  f.db.prepare("UPDATE screenings SET status='cancelled' WHERE id='screen-1'").run();
  assert.ok([404, 409].includes((await f.hold()).statusCode));
  f.db.prepare("UPDATE screenings SET status='scheduled' WHERE id='screen-1'").run();
  f.advance(2 * 86_400_000);
  assert.ok([404, 409].includes((await f.hold(['seat-1'], 'alice', 'past')).statusCode));
});
