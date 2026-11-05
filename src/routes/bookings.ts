import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Context } from '../types.js';
import { ApiError } from '../lib/errors.js';
import {
  cancelBooking, confirmDemoPayment, createBooking, createHold, getBooking,
  getHold, getSeatMap, listBookings, releaseHold,
} from '../lib/booking-service.js';

const identifier = z.string().min(1).max(128);
const idParams = z.object({ id: identifier });
const holdInput = z.object({ screeningId: identifier, seatIds: z.array(identifier).min(1).max(10) })
  .strict().refine(value => new Set(value.seatIds).size === value.seatIds.length, { message: 'Seat IDs must be unique.', path: ['seatIds'] });
const bookingInput = z.object({ holdId: identifier }).strict();
const pagination = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
const security = [{ bearerAuth: [] }];
const idSchema = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 128 } } };
const keySchema = { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 128 } } };

function idempotencyKey(request: FastifyRequest) {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[\x21-\x7E]{1,128}$/.test(key)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Supply an Idempotency-Key header containing 1–128 visible ASCII characters.');
  }
  return key;
}

export async function registerBookings(app: FastifyInstance, ctx: Context) {
  app.get('/api/v1/screenings/:id/seats', {
    schema: { tags: ['Screenings'], summary: 'Read current seats and server-side pricing', params: idSchema },
  }, async request => getSeatMap(ctx, idParams.parse(request.params).id));

  app.post('/api/v1/holds', {
    preHandler: app.authenticate,
    schema: {
      tags: ['Holds'], security, summary: 'Hold up to ten available seats atomically', headers: keySchema,
      body: { type: 'object', additionalProperties: false, required: ['screeningId', 'seatIds'], properties: {
        screeningId: { type: 'string', minLength: 1, maxLength: 128 },
        seatIds: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 128 } },
      } },
    },
  }, async (request, reply) => {
    const input = holdInput.parse(request.body);
    const result = createHold(ctx, request.user.sub, idempotencyKey(request), input);
    return reply.code(201).send(result);
  });

  app.get('/api/v1/holds/:id', {
    preHandler: app.authenticate,
    schema: { tags: ['Holds'], security, summary: 'Read your seat hold, including expiry', params: idSchema },
  }, async request => getHold(ctx, request.user.sub, idParams.parse(request.params).id));

  app.delete('/api/v1/holds/:id', {
    preHandler: app.authenticate,
    schema: { tags: ['Holds'], security, summary: 'Release your unconverted seat hold', params: idSchema },
  }, async request => releaseHold(ctx, request.user.sub, idParams.parse(request.params).id));

  app.post('/api/v1/bookings', {
    preHandler: app.authenticate,
    schema: {
      tags: ['Bookings'], security, summary: 'Create a pending booking from your hold without extending its expiry', headers: keySchema,
      body: { type: 'object', additionalProperties: false, required: ['holdId'], properties: { holdId: { type: 'string', minLength: 1, maxLength: 128 } } },
    },
  }, async (request, reply) => {
    const input = bookingInput.parse(request.body);
    return reply.code(201).send(createBooking(ctx, request.user.sub, idempotencyKey(request), input));
  });

  app.get('/api/v1/bookings', {
    preHandler: app.authenticate,
    schema: { tags: ['Bookings'], security, summary: 'List only your bookings', querystring: { type: 'object', additionalProperties: false, properties: {
      page: { type: 'integer', minimum: 1, maximum: 1_000_000, default: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    } } },
  }, async request => {
    const query = pagination.parse(request.query);
    return listBookings(ctx, request.user.sub, query.page, query.limit);
  });

  app.get('/api/v1/bookings/:id', {
    preHandler: app.authenticate,
    schema: { tags: ['Bookings'], security, summary: 'Read only your booking and demo-payment receipt', params: idSchema },
  }, async request => getBooking(ctx, request.user.sub, idParams.parse(request.params).id));

  app.post('/api/v1/bookings/:id/demo-payment', {
    preHandler: app.authenticate,
    schema: { tags: ['Bookings'], security, summary: 'Confirm a simulated payment; never charges money or creates real tickets',
      description: 'Available only with DEMO_PAYMENTS=true. Booking and seat claims must still be active. Retrying a completed payment never charges again.',
      params: idSchema, headers: keySchema,
    },
  }, async request => {
    if (request.body !== undefined && request.body !== null) z.object({}).strict().parse(request.body);
    return confirmDemoPayment(ctx, request.user.sub, idParams.parse(request.params).id, idempotencyKey(request));
  });

  app.delete('/api/v1/bookings/:id', {
    preHandler: app.authenticate,
    schema: { tags: ['Bookings'], security, summary: 'Cancel your pending booking and release its seats',
      description: 'Confirmed bookings cannot be cancelled or refunded through this API.', params: idSchema },
  }, async request => cancelBooking(ctx, request.user.sub, idParams.parse(request.params).id));
}
