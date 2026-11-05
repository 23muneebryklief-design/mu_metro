# Operating notes

## Configuration

| Variable | Meaning |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `HOST` / `PORT` | Bind address; defaults `127.0.0.1:3000` |
| `DATABASE_PATH` | SQLite file; defaults `./data/mu-metro.db` |
| `JWT_SECRET` | Required random secret, at least 32 characters; example placeholders are rejected |
| `CORS_ORIGINS` | Comma-separated exact HTTP(S) origins, no trailing slash/path/wildcard |
| `HOLD_MINUTES` | Integer 1–20; default 10 |
| `DEMO_PAYMENTS` | Exact `true` or `false`; default false unless local setup opts in |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | First-admin setup only, both or neither |

Keep credentials out of Git, screenshots, logs, and API responses. No real credentials are supplied. Rotating the JWT secret invalidates all existing tokens. Requests are limited to 32 KiB. Registration is limited to five requests per minute per source IP; login to ten; the global limit is 120. Limits are in memory per API process and reset on restart.

## Persistence and contention

SQLite runs with foreign keys, WAL, and a five-second busy timeout. Seat acquisition uses `BEGIN IMMEDIATE` and a unique `(screening_id, seat_id)` claim. Hold creation, booking creation, confirmation, and cancellation are transactional. Confirmed seat claims have no expiry; pending claims retain the original hold deadline. Prices are snapshotted into booking seats at creation.

Use one API instance on a durable local disk for the intended initial deployment. Separate connections on the same disk are protected by SQLite, but SQLite serializes writes; this is not a horizontally distributed booking platform. Do not share the database over an NFS/network filesystem. For substantial cinema traffic, move to a server database with equivalent transactional locking, then load-test contention and operational recovery before launch.

Never discard the Docker volume when upgrading. Back up using SQLite's online backup API/tool or stop the service before copying its database. A live WAL database cannot be safely backed up by copying only the `.db` file. Test restores before relying on a backup. Migrations are ordered SQL files in `migrations/`, recorded transactionally in `schema_migrations`; append new migrations rather than editing applied ones.

## External access and release status

The application is an implemented and tested development backend. Docker configuration is provided; a production hosting account is not connected. The Docker image itself must be built and verified in your deployment environment. Keep the service behind HTTPS when exposing customer authentication. Configure reverse-proxy forwarding deliberately: `trustProxy` defaults to false so clients cannot spoof rate-limit identities. Behind a proxy all clients can share a limit until trusted proxy IP handling is configured for that deployment.

Security headers and exact-origin CORS are enabled; CORS is not authentication. Catalogue reads are public; personal records require bearer authentication and ownership. Admin membership is checked against the database for every admin request. Do not put access tokens in URLs; keep them in application memory where possible. Swagger documents the API and is accessible without login; it includes no customer records or secrets.

## Integrations still required for a real cinema business

- Official Nu Metro inventory/ticketing API access or an authorized data-import process.
- A merchant payment integration with verified server callbacks, amount/currency checks, webhook replay protection, reconciliation, and refunds. Do not replace demo payment with a frontend success flag.
- Transactional email delivery and real ticket issuance/check-in.
- Account recovery, email verification, retention/deletion policies, and operational support procedures.
- Capacity/load testing, monitoring, backups, and a production security/privacy review tailored to the deployment.

No real payment route, arbitrary payment-success callback, or unverified webhook is exposed. With `DEMO_PAYMENTS=false`, reservations can be created, but payment confirmation returns 503 and pending reservations expire normally. Demo receipts and references are not admission tickets. No production-readiness or zero-defect guarantee is implied by passing automated checks.
