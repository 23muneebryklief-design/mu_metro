# API usage

Base URL: `/api/v1`. JSON request bodies use camelCase. Successful resources use `{ "data": ... }`; lists also include `pagination: { page, limit, total }`. Errors use `{ "error": { "code", "message", "details"? }, "requestId" }`. Browse `/docs` or download `/docs/json` for request schemas.

## Routes

| Method | Path | Access / purpose |
| --- | --- | --- |
| POST | `/auth/register` | Public: `{name,email,password}`; password 12–128 characters |
| POST | `/auth/login` | Public: `{email,password}`; returns bearer token |
| GET | `/auth/me` | Customer: current profile |
| POST | `/auth/logout` | Customer: revoke all sessions |
| GET | `/movies` | Public: `search`, `status=now_showing\|coming_soon`, `genre`, `page`, `limit` |
| GET | `/movies/:id` | Public: published film |
| GET | `/cinemas` | Public: `city`, `page`, `limit` |
| GET | `/cinemas/:id` | Public: cinema and auditorium summaries |
| GET | `/screenings` | Public: `movieId`, `cinemaId`, `date=YYYY-MM-DD`, `experience`, `page`, `limit` |
| GET | `/screenings/:id` | Public: future scheduled screening |
| GET | `/screenings/:id/seats` | Public: seat IDs, kinds, current status, and price |
| POST | `/holds` | Customer: `{screeningId,seatIds}`; idempotency key required |
| GET | `/holds/:id` | Hold owner: current status and deadline |
| DELETE | `/holds/:id` | Hold owner: release an unconverted hold |
| POST | `/bookings` | Customer: `{holdId}`; idempotency key required |
| GET | `/bookings` | Customer: own bookings, `page`, `limit` |
| GET | `/bookings/:id` | Booking owner: current status and receipt |
| DELETE | `/bookings/:id` | Booking owner: cancel a pending booking |
| POST | `/bookings/:id/demo-payment` | Booking owner: simulated confirmation; idempotency key required |
| POST | `/admin/movies` | Admin: create a film |
| PATCH | `/admin/movies/:id` | Admin: update film fields |
| POST | `/admin/cinemas` | Admin: create a cinema |
| PATCH | `/admin/cinemas/:id` | Admin: update cinema fields |
| POST | `/admin/auditoriums` | Admin: create an auditorium and rectangular seat map |
| PATCH | `/admin/auditoriums/:id` | Admin: update name/experience; layout stays immutable |
| POST | `/admin/screenings` | Admin: schedule a screening |
| PATCH | `/admin/screenings/:id` | Admin: update or cancel a screening |

For protected requests send `Authorization: Bearer <accessToken>` from login/registration. Tokens last 900 seconds; sign in again after expiry. Logout revokes all sessions for that user. No refresh-token, password-reset, or email-verification flow is implemented.

Pagination defaults to page 1, limit 20; limit cannot exceed 100. Dates use the South African calendar day, while all returned timestamps are ISO 8601 UTC. Experiences are `2D`, `3D`, `Xtreme`, `VIP`, or `4DX`.

## Booking sequence

1. Register or log in. Read the returned `data.accessToken`.
2. Read `/screenings?cinemaId=...` and select a screening ID.
3. Read `/screenings/{id}/seats` and select actual `seatId` values. Seat-map availability is a snapshot; a subsequent hold can fail if someone else reserves first.
4. Create a hold with `POST /holds`:

```http
Authorization: Bearer <accessToken>
Idempotency-Key: unique-hold-attempt-01
Content-Type: application/json
```

```json
{
  "screeningId": "screening-demo-0-0-0",
  "seatIds": ["auditorium-demo-cape-town-1-B-4", "auditorium-demo-cape-town-1-B-5"]
}
```

5. Before `data.expiresAt`, create a pending booking:

```http
POST /api/v1/bookings
Authorization: Bearer <accessToken>
Idempotency-Key: unique-booking-attempt-01
Content-Type: application/json
```

```json
{ "holdId": "<data.id from the hold response>" }
```

6. In explicitly enabled demo mode, send `POST /bookings/{id}/demo-payment` with a new `Idempotency-Key` and bearer token, **without a body**. A confirmed response has `status: "confirmed"` and `isDemo: true`. This does not charge money or create a valid Nu Metro ticket.
7. Refetch `/bookings/{id}` for the current status. The owner can cancel a pending booking. Confirmed bookings cannot be cancelled/refunded through this API.

Hold expiry defaults to ten minutes and is capped at screening start. Creating a booking does not extend the original hold deadline. Expiry cleanup occurs transactionally during reservation reads and writes, so a background cleanup process is not needed for availability correctness.

## Retries and idempotency

The three POST operations for holds, bookings, and demo payment require `Idempotency-Key`: 1–128 visible ASCII characters without spaces. Generate a unique key for a new operation. Reuse that same key after a network timeout.

Keys are scoped to the authenticated user and operation. A matching retry returns its **original stored response**; the snapshot may show an older status after expiry or cancellation. Refetch the resource with GET for its current state. Reusing a key with a different request returns `409 IDEMPOTENCY_CONFLICT`. A failed operation does not reserve the key. Keys are currently retained indefinitely.

## Prices and admin rules

All amounts are integer **ZAR cents**: `12500` is R125.00. Booking totals are calculated from stored screening prices and selected seats. Client price fields are rejected. No taxes, discounts, concessions, seat surcharges, or loyalty integrations are configured.

Create a movie with `slug`, `title`, `synopsis`, `durationMinutes`, `ageRating`, `genre`, `status`, `releaseDate` and optional `posterUrl`. Create a cinema with `slug`, `name`, `city`, `address`; timezone is fixed to `Africa/Johannesburg`. Create an auditorium with `cinemaId`, `name`, `experience`, `rows` (1–26), and `seatsPerRow` (1–50). Created layouts use standard seats; seeded layouts additionally demonstrate wheelchair/companion seats.

Create a screening with `movieId`, `auditoriumId`, `startsAt` (ISO timestamp with timezone), and positive `priceCents`. Its end is calculated from movie duration. Scheduled screenings cannot overlap, including a 20-minute turnaround. Draft movies and inactive cinemas cannot be scheduled. Current reservations prevent screening edits. Runtime, cinema activation, and experience changes have schedule guards.

Cancel a screening with only `{ "status": "cancelled" }`. This releases holds and cancels pending bookings atomically. Confirmed bookings block cancellation because no refund integration exists.
