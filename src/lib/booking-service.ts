import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Context } from '../types.js';
import { transaction } from '../db.js';
import { ApiError } from './errors.js';

type HoldRow = { id: string; user_id: string; screening_id: string; status: string; expires_at: string; created_at: string };
type BookingRow = {
  id: string; reference: string; user_id: string; hold_id: string; screening_id: string;
  status: string; total_cents: number; currency: string; payment_mode: string;
  created_at: string; confirmed_at: string | null;
};
type ScreeningRow = {
  id: string; auditorium_id: string; starts_at: string; price_cents: number; status: string;
  movie_status: string; cinema_active: number;
};

const nowIso = (ctx: Context) => new Date(ctx.config.clock()).toISOString();

/** Must be called inside the caller's transaction. No asynchronous work is permitted. */
export function expireReservations(ctx: Context, now: string) {
  const { db } = ctx;
  db.prepare(`UPDATE holds SET status = 'expired' WHERE expires_at <= ? AND
    (status = 'active' OR (status = 'converted' AND EXISTS
      (SELECT 1 FROM bookings b WHERE b.hold_id = holds.id AND b.status = 'pending')))` ).run(now);
  db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE status = 'pending'
    AND hold_id IN (SELECT id FROM holds WHERE expires_at <= ?)` ).run(now);
  db.prepare('DELETE FROM seat_claims WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now);
}

function audit(ctx: Context, userId: string, action: string, entityId: string, now: string, details: unknown = {}) {
  ctx.db.prepare('INSERT INTO audit_logs (id,user_id,action,entity_id,details,created_at) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), userId, action, entityId, JSON.stringify(details), now);
}

function screening(ctx: Context, id: string, now: string): ScreeningRow {
  const row = ctx.db.prepare(`SELECT s.*, m.status AS movie_status, c.active AS cinema_active
    FROM screenings s JOIN movies m ON m.id = s.movie_id
    JOIN auditoriums a ON a.id = s.auditorium_id JOIN cinemas c ON c.id = a.cinema_id
    WHERE s.id = ?`).get(id) as ScreeningRow | undefined;
  if (!row || row.movie_status === 'draft' || !row.cinema_active) {
    throw new ApiError(404, 'SCREENING_NOT_FOUND', 'Screening not found.');
  }
  if (row.status !== 'scheduled') throw new ApiError(409, 'SCREENING_CANCELLED', 'This screening has been cancelled.');
  if (row.starts_at <= now) throw new ApiError(409, 'SCREENING_STARTED', 'This screening has already started.');
  return row;
}

function ownedHold(ctx: Context, id: string, userId: string): HoldRow {
  const row = ctx.db.prepare('SELECT * FROM holds WHERE id = ? AND user_id = ?').get(id, userId) as HoldRow | undefined;
  if (!row) throw new ApiError(404, 'HOLD_NOT_FOUND', 'Seat hold not found.');
  return row;
}

function ownedBooking(ctx: Context, id: string, userId: string): BookingRow {
  const row = ctx.db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(id, userId) as BookingRow | undefined;
  if (!row) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
  return row;
}

function holdView(ctx: Context, hold: HoldRow) {
  const seats = ctx.db.prepare('SELECT seat_id FROM hold_seats WHERE hold_id = ? ORDER BY seat_id').all(hold.id) as { seat_id: string }[];
  return {
    id: hold.id, screeningId: hold.screening_id, status: hold.status,
    expiresAt: hold.expires_at, createdAt: hold.created_at, seatIds: seats.map(s => s.seat_id),
  };
}

function bookingView(ctx: Context, booking: BookingRow) {
  const seats = ctx.db.prepare(`SELECT bs.seat_id, bs.price_cents, s.row_label, s.number, s.kind
    FROM booking_seats bs JOIN seats s ON s.id = bs.seat_id WHERE bs.booking_id = ?
    ORDER BY s.row_label,s.number`).all(booking.id) as { seat_id: string; price_cents: number; row_label: string; number: number; kind: string }[];
  const payment = ctx.db.prepare('SELECT provider,status,amount_cents,currency,reference,created_at FROM payments WHERE booking_id = ?')
    .get(booking.id) as { provider: string; status: string; amount_cents: number; currency: string; reference: string; created_at: string } | undefined;
  const hold = ctx.db.prepare('SELECT expires_at FROM holds WHERE id = ?').get(booking.hold_id) as { expires_at: string };
  return {
    id: booking.id, reference: booking.reference, screeningId: booking.screening_id, holdId: booking.hold_id,
    status: booking.status, totalCents: booking.total_cents, currency: booking.currency,
    paymentMode: booking.payment_mode, createdAt: booking.created_at, confirmedAt: booking.confirmed_at,
    expiresAt: booking.status === 'pending' ? hold.expires_at : null,
    isDemo: booking.payment_mode === 'demo',
    seats: seats.map(s => ({ seatId: s.seat_id, rowLabel: s.row_label, number: s.number, kind: s.kind, priceCents: s.price_cents })),
    payment: payment ? {
      provider: payment.provider, status: payment.status, amountCents: payment.amount_cents,
      currency: payment.currency, reference: payment.reference, createdAt: payment.created_at,
    } : null,
  };
}

/** The result and key are committed together. Replay never executes business logic again. */
function idempotent<T>(ctx: Context, userId: string, scope: string, key: string, input: unknown, now: string, operation: () => T): T {
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const existing = ctx.db.prepare('SELECT request_hash,response_json FROM idempotency_keys WHERE user_id = ? AND scope = ? AND key = ?')
    .get(userId, scope, key) as { request_hash: string; response_json: string } | undefined;
  if (existing) {
    if (existing.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with a different request.');
    return JSON.parse(existing.response_json) as T;
  }
  const result = operation();
  ctx.db.prepare('INSERT INTO idempotency_keys (user_id,scope,key,request_hash,response_json,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, scope, key, hash, JSON.stringify(result), now);
  return result;
}

export function getSeatMap(ctx: Context, screeningId: string) {
  return transaction(ctx.db, () => {
    const now = nowIso(ctx);
    expireReservations(ctx, now);
    const show = screening(ctx, screeningId, now);
    const seats = ctx.db.prepare(`SELECT s.id,s.row_label,s.number,s.kind,c.booking_id,c.hold_id,c.expires_at,
      b.status AS booking_status FROM seats s LEFT JOIN seat_claims c
      ON c.seat_id = s.id AND c.screening_id = ? LEFT JOIN bookings b ON b.id = c.booking_id
      WHERE s.auditorium_id = ? ORDER BY s.row_label,s.number`).all(screeningId, show.auditorium_id) as {
        id: string; row_label: string; number: number; kind: string; booking_id: string | null;
        hold_id: string | null; expires_at: string | null; booking_status: string | null;
      }[];
    return { data: {
      screeningId, currency: 'ZAR', priceCents: show.price_cents,
      seats: seats.map(s => ({ seatId: s.id, rowLabel: s.row_label, number: s.number, kind: s.kind,
        status: s.hold_id ? s.booking_status === 'confirmed' ? 'booked' : 'held' : 'available' })),
    } };
  });
}

export function createHold(ctx: Context, userId: string, key: string, input: { screeningId: string; seatIds: string[] }) {
  return transaction(ctx.db, () => {
    const now = nowIso(ctx);
    expireReservations(ctx, now);
    // Treat seat selection as a set for replay purposes.
    const normalized = { screeningId: input.screeningId, seatIds: [...input.seatIds].sort() };
    return idempotent(ctx, userId, 'create-hold', key, normalized, now, () => {
      const show = screening(ctx, input.screeningId, now);
      const count = ctx.db.prepare(`SELECT count(*) AS total FROM holds h WHERE user_id = ?
        AND (h.status = 'active' OR (h.status = 'converted' AND EXISTS
          (SELECT 1 FROM bookings b WHERE b.hold_id = h.id AND b.status = 'pending')))` ).get(userId) as { total: number };
      if (count.total >= 3) throw new ApiError(409, 'HOLD_LIMIT', 'You may have at most three active seat reservations.');
      for (const seatId of normalized.seatIds) {
        if (!ctx.db.prepare('SELECT 1 FROM seats WHERE id = ? AND auditorium_id = ?').get(seatId, show.auditorium_id)) {
          throw new ApiError(400, 'INVALID_SEAT', 'A selected seat does not belong to this screening.');
        }
        if (ctx.db.prepare('SELECT 1 FROM seat_claims WHERE screening_id = ? AND seat_id = ?').get(show.id, seatId)) {
          throw new ApiError(409, 'SEAT_UNAVAILABLE', 'One or more selected seats are no longer available.');
        }
      }
      const id = randomUUID();
      const expiresAt = new Date(Math.min(ctx.config.clock() + ctx.config.holdMinutes * 60_000, Date.parse(show.starts_at))).toISOString();
      ctx.db.prepare("INSERT INTO holds (id,user_id,screening_id,status,expires_at,created_at) VALUES (?,?,?,'active',?,?)")
        .run(id, userId, show.id, expiresAt, now);
      const holdSeat = ctx.db.prepare('INSERT INTO hold_seats (hold_id,seat_id) VALUES (?,?)');
      const claim = ctx.db.prepare('INSERT INTO seat_claims (screening_id,seat_id,hold_id,expires_at) VALUES (?,?,?,?)');
      for (const seatId of normalized.seatIds) { holdSeat.run(id, seatId); claim.run(show.id, seatId, id, expiresAt); }
      audit(ctx, userId, 'hold.created', id, now, { screeningId: show.id, seatCount: normalized.seatIds.length });
      return { data: holdView(ctx, ownedHold(ctx, id, userId)) };
    });
  });
}

export function getHold(ctx: Context, userId: string, id: string) {
  return transaction(ctx.db, () => {
    expireReservations(ctx, nowIso(ctx));
    return { data: holdView(ctx, ownedHold(ctx, id, userId)) };
  });
}

export function releaseHold(ctx: Context, userId: string, id: string) {
  return transaction(ctx.db, () => {
    const now = nowIso(ctx); expireReservations(ctx, now);
    const hold = ownedHold(ctx, id, userId);
    if (hold.status === 'converted') throw new ApiError(409, 'HOLD_CONVERTED', 'Cancel the associated pending booking to release these seats.');
    if (hold.status === 'active') {
      ctx.db.prepare("UPDATE holds SET status = 'released' WHERE id = ?").run(id);
      ctx.db.prepare('DELETE FROM seat_claims WHERE hold_id = ? AND booking_id IS NULL').run(id);
      audit(ctx, userId, 'hold.released', id, now);
    }
    return { data: holdView(ctx, ownedHold(ctx, id, userId)) };
  });
}

export function createBooking(ctx: Context, userId: string, key: string, input: { holdId: string }) {
  return transaction(ctx.db, () => {
    const now = nowIso(ctx); expireReservations(ctx, now);
    return idempotent(ctx, userId, 'create-booking', key, input, now, () => {
      const hold = ownedHold(ctx, input.holdId, userId);
      if (hold.status !== 'active' || hold.expires_at <= now) throw new ApiError(409, 'HOLD_INACTIVE', 'This seat hold is no longer active. Select seats again.');
      const show = screening(ctx, hold.screening_id, now);
      const seats = ctx.db.prepare('SELECT seat_id FROM hold_seats WHERE hold_id = ? ORDER BY seat_id').all(hold.id) as { seat_id: string }[];
      const claims = ctx.db.prepare('SELECT count(*) AS total FROM seat_claims WHERE hold_id = ? AND booking_id IS NULL AND expires_at > ?')
        .get(hold.id, now) as { total: number };
      if (!seats.length || claims.total !== seats.length) throw new ApiError(409, 'HOLD_INACTIVE', 'The held seats are no longer available.');
      const id = randomUUID();
      const reference = `DEMO-${randomBytes(8).toString('hex').toUpperCase()}`;
      const paymentMode = ctx.config.demoPayments ? 'demo' : 'unconfigured';
      ctx.db.prepare(`INSERT INTO bookings
        (id,reference,user_id,hold_id,screening_id,status,total_cents,currency,payment_mode,created_at)
        VALUES (?,?,?,?,?,'pending',?,'ZAR',?,?)`)
        .run(id, reference, userId, hold.id, show.id, seats.length * show.price_cents, paymentMode, now);
      const statement = ctx.db.prepare('INSERT INTO booking_seats (booking_id,seat_id,price_cents) VALUES (?,?,?)');
      for (const seat of seats) statement.run(id, seat.seat_id, show.price_cents);
      ctx.db.prepare("UPDATE holds SET status = 'converted' WHERE id = ?").run(hold.id);
      ctx.db.prepare('UPDATE seat_claims SET booking_id = ? WHERE hold_id = ?').run(id, hold.id);
      audit(ctx, userId, 'booking.created', id, now, { totalCents: seats.length * show.price_cents, paymentMode });
      return { data: bookingView(ctx, ownedBooking(ctx, id, userId)) };
    });
  });
}

export function listBookings(ctx: Context, userId: string, page: number, limit: number) {
  return transaction(ctx.db, () => {
    expireReservations(ctx, nowIso(ctx));
    const count = ctx.db.prepare('SELECT count(*) AS total FROM bookings WHERE user_id = ?').get(userId) as { total: number };
    const rows = ctx.db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?')
      .all(userId, limit, (page - 1) * limit) as BookingRow[];
    return { data: rows.map(b => bookingView(ctx, b)), pagination: { page, limit, total: count.total } };
  });
}

export function getBooking(ctx: Context, userId: string, id: string) {
  return transaction(ctx.db, () => {
    expireReservations(ctx, nowIso(ctx));
    return { data: bookingView(ctx, ownedBooking(ctx, id, userId)) };
  });
}

export function confirmDemoPayment(ctx: Context, userId: string, id: string, key: string) {
  if (!ctx.config.demoPayments) throw new ApiError(503, 'PAYMENT_NOT_CONFIGURED', 'Demo payments are disabled. A live payment provider has not been configured.');
  return transaction(ctx.db, () => {
    const now = nowIso(ctx); expireReservations(ctx, now);
    return idempotent(ctx, userId, 'demo-payment', key, { bookingId: id }, now, () => {
      const booking = ownedBooking(ctx, id, userId);
      if (booking.payment_mode !== 'demo') throw new ApiError(409, 'PAYMENT_MODE_MISMATCH', 'This booking was not created in demo-payment mode.');
      if (booking.status === 'confirmed') return { data: bookingView(ctx, booking) };
      if (booking.status !== 'pending') throw new ApiError(409, 'BOOKING_INACTIVE', 'This booking cannot be paid.');
      screening(ctx, booking.screening_id, now);
      const hold = ownedHold(ctx, booking.hold_id, userId);
      if (hold.expires_at <= now || hold.status !== 'converted') throw new ApiError(409, 'HOLD_INACTIVE', 'This reservation has expired.');
      const claimed = ctx.db.prepare('SELECT count(*) AS total FROM seat_claims WHERE booking_id = ? AND expires_at > ?')
        .get(id, now) as { total: number };
      const selected = ctx.db.prepare('SELECT count(*) AS total FROM booking_seats WHERE booking_id = ?').get(id) as { total: number };
      if (claimed.total !== selected.total || !claimed.total) throw new ApiError(409, 'SEAT_UNAVAILABLE', 'This booking no longer owns its selected seats.');
      ctx.db.prepare("UPDATE bookings SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(now, id);
      ctx.db.prepare('UPDATE seat_claims SET expires_at = NULL WHERE booking_id = ?').run(id);
      ctx.db.prepare(`INSERT INTO payments (id,booking_id,provider,status,amount_cents,currency,reference,created_at)
        VALUES (?,?,'demo','succeeded',?,'ZAR',?,?)`).run(randomUUID(), id, booking.total_cents, `DEMO-PAY-${randomUUID()}`, now);
      audit(ctx, userId, 'payment.demo_confirmed', id, now, { amountCents: booking.total_cents });
      return { data: bookingView(ctx, ownedBooking(ctx, id, userId)) };
    });
  });
}

export function cancelBooking(ctx: Context, userId: string, id: string) {
  return transaction(ctx.db, () => {
    const now = nowIso(ctx); expireReservations(ctx, now);
    const booking = ownedBooking(ctx, id, userId);
    if (booking.status === 'confirmed') throw new ApiError(409, 'CONFIRMED_BOOKING', 'Confirmed bookings cannot be cancelled through this API. Contact the cinema for assistance.');
    if (booking.status === 'pending') {
      ctx.db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
      ctx.db.prepare("UPDATE holds SET status = 'released' WHERE id = ?").run(booking.hold_id);
      ctx.db.prepare('DELETE FROM seat_claims WHERE booking_id = ?').run(id);
      audit(ctx, userId, 'booking.cancelled', id, now);
    }
    return { data: bookingView(ctx, ownedBooking(ctx, id, userId)) };
  });
}
