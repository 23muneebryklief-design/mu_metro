import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transaction, type Database } from './db.js';
import { hashPassword } from './lib/password.js';

export interface SeedOptions { adminEmail?: string; adminPassword?: string; now?: number }
/** Fictional demonstration content only. No live Nu Metro schedule or customer data. */
export async function seed(db: Database, options: SeedOptions = {}) {
  const at = options.now ?? Date.now();
  if (!Number.isFinite(at)) throw new Error('The seed clock must be a valid timestamp.');
  if (Boolean(options.adminEmail) !== Boolean(options.adminPassword)) throw new Error('Set both SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD, or neither.');
  const credentials = options.adminEmail && options.adminPassword ? z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), password: z.string().min(12).max(128) }).parse({ email: options.adminEmail, password: options.adminPassword }) : undefined;
  const existing = credentials ? db.prepare('SELECT id,role FROM users WHERE email=?').get(credentials.email) : undefined;
  if (existing && existing.role !== 'admin') throw new Error('The requested admin email already belongs to a customer. Choose a new admin email.');
  const passwordHash = credentials && !existing ? await hashPassword(credentials.password) : undefined;
  const currentDate = new Date(at).toISOString().slice(0, 10);
  const futureDate = new Date(at + 30 * 86400000).toISOString().slice(0, 10);
  transaction(db, () => {
    if (credentials && passwordHash) {
      db.prepare('INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), credentials.email, passwordHash, 'Administrator', 'admin', new Date(at).toISOString());
    }
    const insertMovie = db.prepare('INSERT OR IGNORE INTO movies (id,slug,title,synopsis,duration_minutes,age_rating,genre,poster_url,status,release_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    insertMovie.run('movie-demo-orbit', 'demo-orbit-beyond-the-silence', 'Orbit: Beyond the Silence', 'Fictional demo movie. A young engineer follows a mysterious signal beyond the edge of a silent solar system.', 120, '13', 'Science Fiction', null, 'now_showing', currentDate, new Date(at).toISOString());
    insertMovie.run('movie-demo-karoo', 'demo-the-karoo-road', 'The Karoo Road', 'Fictional demo movie. Two estranged siblings take a road trip across the Karoo and find an unexpected way home.', 100, 'PG', 'Drama', null, 'now_showing', currentDate, new Date(at).toISOString());
    insertMovie.run('movie-demo-tides', 'demo-tides-of-tomorrow', 'Tides of Tomorrow', 'Fictional demo movie. A coastal community discovers an extraordinary secret beneath the waves.', 110, 'PG', 'Adventure', null, 'coming_soon', futureDate, new Date(at).toISOString());
    const cinemas = [
      { id: 'cinema-demo-cape-town', slug: 'demo-cape-town', name: 'Demo Cinema — Cape Town', city: 'Cape Town', address: 'Demonstration location, Cape Town, South Africa', experience: '2D' },
      { id: 'cinema-demo-johannesburg', slug: 'demo-johannesburg', name: 'Demo Cinema — Johannesburg', city: 'Johannesburg', address: 'Demonstration location, Johannesburg, South Africa', experience: 'Xtreme' },
    ];
    const insertCinema = db.prepare('INSERT OR IGNORE INTO cinemas (id,slug,name,city,address,timezone,active) VALUES (?,?,?,?,?,?,1)');
    const insertAuditorium = db.prepare('INSERT OR IGNORE INTO auditoriums (id,cinema_id,name,experience) VALUES (?,?,?,?)');
    const insertSeat = db.prepare('INSERT OR IGNORE INTO seats (id,auditorium_id,row_label,number,kind) VALUES (?,?,?,?,?)');
    const insertScreening = db.prepare('INSERT OR IGNORE INTO screenings (id,movie_id,auditorium_id,starts_at,ends_at,price_cents,status) VALUES (?,?,?,?,?,?,?)');
    // Start on tomorrow's South African calendar day. Local showtimes: 12:00, 16:00, 20:00.
    const localToday = new Date(at + 2 * 3600000).toISOString().slice(0, 10);
    const dayStart = Date.parse(`${localToday}T00:00:00+02:00`);
    for (const [cinemaIndex, cinema] of cinemas.entries()) {
      insertCinema.run(cinema.id, cinema.slug, cinema.name, cinema.city, cinema.address, 'Africa/Johannesburg');
      const auditoriumId = `${cinema.id.replace('cinema-', 'auditorium-')}-1`;
      insertAuditorium.run(auditoriumId, cinema.id, 'Screen 1', cinema.experience);
      for (let row = 0; row < 6; row++) for (let number = 1; number <= 10; number++) {
        const label = String.fromCharCode(65 + row);
        insertSeat.run(`${auditoriumId}-${label}-${number}`, auditoriumId, label, number, row === 0 && number === 1 ? 'wheelchair' : row === 0 && number === 2 ? 'companion' : 'standard');
      }
      for (let day = 0; day < 7; day++) for (let slot = 0; slot < 3; slot++) {
        const start = dayStart + (day + 1) * 86400000 + (12 + slot * 4) * 3600000;
        const movieId = slot === 1 ? 'movie-demo-karoo' : 'movie-demo-orbit';
        const runtime = slot === 1 ? 100 : 120;
        insertScreening.run(`screening-demo-${day}-${cinemaIndex}-${slot}`, movieId, auditoriumId, new Date(start).toISOString(), new Date(start + runtime * 60000).toISOString(), cinemaIndex === 0 ? 9900 : 12900, 'scheduled');
      }
    }
  });
  return { movies: 3, cinemas: 2, auditoriums: 2, screenings: 42, adminCreated: Boolean(passwordHash), demo: true };
}
