CREATE TABLE users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
 token_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE movies (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, synopsis TEXT NOT NULL,
 duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 1 AND 600),
 age_rating TEXT NOT NULL, genre TEXT NOT NULL, poster_url TEXT,
 status TEXT NOT NULL CHECK(status IN ('now_showing','coming_soon','draft')),
 release_date TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE cinemas (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, city TEXT NOT NULL,
 address TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
) STRICT;
CREATE TABLE auditoriums (
 id TEXT PRIMARY KEY, cinema_id TEXT NOT NULL REFERENCES cinemas(id), name TEXT NOT NULL,
 experience TEXT NOT NULL CHECK(experience IN ('2D','3D','Xtreme','VIP','4DX')),
 UNIQUE(cinema_id,name)
) STRICT;
CREATE TABLE seats (
 id TEXT PRIMARY KEY, auditorium_id TEXT NOT NULL REFERENCES auditoriums(id),
 row_label TEXT NOT NULL, number INTEGER NOT NULL CHECK(number > 0),
 kind TEXT NOT NULL DEFAULT 'standard' CHECK(kind IN ('standard','wheelchair','companion')),
 UNIQUE(auditorium_id,row_label,number)
) STRICT;
CREATE TABLE screenings (
 id TEXT PRIMARY KEY, movie_id TEXT NOT NULL REFERENCES movies(id),
 auditorium_id TEXT NOT NULL REFERENCES auditoriums(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
 price_cents INTEGER NOT NULL CHECK(price_cents > 0 AND price_cents <= 1000000),
 status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','cancelled')),
 CHECK(ends_at > starts_at)
) STRICT;
CREATE INDEX screenings_by_time ON screenings(starts_at,movie_id,auditorium_id);
CREATE TABLE holds (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 screening_id TEXT NOT NULL REFERENCES screenings(id),
 status TEXT NOT NULL CHECK(status IN ('active','converted','released','expired')),
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX holds_by_user ON holds(user_id,status);
CREATE TABLE hold_seats (
 hold_id TEXT NOT NULL REFERENCES holds(id), seat_id TEXT NOT NULL REFERENCES seats(id),
 PRIMARY KEY(hold_id,seat_id)
) STRICT;
CREATE TABLE bookings (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id),
 hold_id TEXT NOT NULL UNIQUE REFERENCES holds(id), screening_id TEXT NOT NULL REFERENCES screenings(id),
 status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelled')),
 total_cents INTEGER NOT NULL CHECK(total_cents > 0), currency TEXT NOT NULL DEFAULT 'ZAR' CHECK(currency = 'ZAR'),
 payment_mode TEXT NOT NULL CHECK(payment_mode IN ('demo','unconfigured')),
 created_at TEXT NOT NULL, confirmed_at TEXT
) STRICT;
CREATE INDEX bookings_by_user ON bookings(user_id,created_at);
CREATE TABLE booking_seats (
 booking_id TEXT NOT NULL REFERENCES bookings(id), seat_id TEXT NOT NULL REFERENCES seats(id),
 price_cents INTEGER NOT NULL CHECK(price_cents > 0), PRIMARY KEY(booking_id,seat_id)
) STRICT;
CREATE TABLE seat_claims (
 screening_id TEXT NOT NULL REFERENCES screenings(id), seat_id TEXT NOT NULL REFERENCES seats(id),
 hold_id TEXT NOT NULL REFERENCES holds(id), booking_id TEXT REFERENCES bookings(id), expires_at TEXT,
 PRIMARY KEY(screening_id,seat_id)
) STRICT;
CREATE INDEX claims_by_expiry ON seat_claims(expires_at);
CREATE TABLE payments (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
 provider TEXT NOT NULL CHECK(provider = 'demo'), status TEXT NOT NULL CHECK(status IN ('succeeded','refunded')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), currency TEXT NOT NULL CHECK(currency = 'ZAR'),
 reference TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE idempotency_keys (
 user_id TEXT NOT NULL REFERENCES users(id), scope TEXT NOT NULL, key TEXT NOT NULL,
 request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,scope,key)
) STRICT;
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), action TEXT NOT NULL,
 entity_id TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
) STRICT;
