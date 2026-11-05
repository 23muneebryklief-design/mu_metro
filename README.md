# Mu Metro

Cinema website development project with a TypeScript/Fastify backend, Node.js 24, persistent SQLite, and a React + TypeScript frontend in `frontend/`.

This is an independent development project, not an official Nu Metro service. The seed catalogue contains fictional films and demonstration cinemas. It does not fetch real Nu Metro availability, charge cards, send emails, or issue valid cinema tickets.

## Run locally

Install **Node.js 24 LTS**, then run these commands from the project directory:

```sh
npm ci
npm run setup
npm run db:seed
npm run dev
```

`setup` creates a git-ignored `.env` with a random JWT secret. It preserves an existing `.env`. The generated local configuration explicitly enables demo payments; without that opt-in the API refuses payment confirmation.

- API: `http://127.0.0.1:3000/api/v1`
- Interactive API docs: `http://127.0.0.1:3000/docs`
- OpenAPI JSON: `http://127.0.0.1:3000/docs/json`
- Database readiness: `http://127.0.0.1:3000/health`

Migrations run automatically at startup. `npm run db:migrate` is also available. The database is stored at `data/mu-metro.db`, survives restarts, and is excluded from Git. Seed data creates an initial seven-day schedule starting tomorrow in South African time. Rerunning the seed preserves existing records and dates; it does not refresh an old schedule.

## Create an administrator

There is **no default administrator login**. Add your own credentials to the ignored `.env`, then run `npm run db:seed`:

```dotenv
SEED_ADMIN_EMAIL=your-address@example.com
SEED_ADMIN_PASSWORD=a-unique-long-password-of-your-own
```

Use at least 12 characters. Remove these two values from `.env` after successful setup. Log in using `/api/v1/auth/login`. Seeding will not reset an existing admin's password or elevate an existing customer account.

## Included features

- Customer registration, login, profile, and logout that revokes all current sessions.
- Salted scrypt password hashes, 15-minute JWTs, live role checks, rate limits, and exact-origin CORS.
- Movies, cinema locations, auditoriums, experiences, seats, and upcoming screenings.
- Search, bounded pagination, and screening date filters using `Africa/Johannesburg` calendar days.
- Administrator create/update APIs for catalogue and schedules, audit records, and overlap checks with 20 minutes between screenings.
- Atomic, expiring seat holds: up to ten seats per hold and three active reservations per customer.
- Owner-only bookings, server-calculated integer ZAR cents, idempotent writes, and explicit demo payment confirmation.
- Schema migrations, seed data, Swagger/OpenAPI, Docker configuration, and GitHub Actions checks.

See [API usage](docs/API.md) for routes and the complete booking sequence, and [operating notes](docs/OPERATIONS.md) for deployment and limits.

## Verify and build

```sh
npm run typecheck
npm test
npm run build
npm start
```

Tests use isolated databases and injected requests; the concurrency test uses separate processes against an on-disk database. They do not require real payment credentials or mutate your local database. The compiled server still requires the project-level `migrations/` directory and starts from the project directory.

## Docker

Create `.env` as above, then:

```sh
docker compose up --build -d
```

The database uses the persistent `cinema-data` volume. To add the sample catalogue in the container:

```sh
docker compose exec api node dist/seed-cli.js
```

To create the first admin in the container, set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in your shell, then use:

```sh
docker compose exec -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD api node dist/seed-cli.js
```

The container image includes the compiled seed CLI and does not require development dependencies at runtime. Compose binds the API to loopback. Configure HTTPS at a reverse proxy before external use.

## React frontend

See [frontend setup](frontend/README.md). In a separate terminal, run:

```sh
cd frontend
npm ci
npm run dev
```

The frontend runs at http://localhost:5173 and proxies API requests to the backend on port 3000.
