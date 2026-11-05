import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Context } from '../types.js';
import { transaction } from '../db.js';
import { ApiError } from '../lib/errors.js';

type Row = Record<string, any>;
const idParams = z.object({ id: z.string().min(1).max(100) });
const pagination = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
const slug = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Use a valid calendar date in YYYY-MM-DD format.');
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)), 'Use an ISO 8601 date with an offset.');
const movieBody = z.object({
  slug, title: z.string().trim().min(1).max(200), synopsis: z.string().trim().min(1).max(10000),
  durationMinutes: z.number().int().min(1).max(600), ageRating: z.string().trim().min(1).max(30),
  genre: z.string().trim().min(1).max(100), posterUrl: z.string().url().max(2000).refine(value => /^https?:\/\//.test(value)).nullable().optional(),
  status: z.enum(['now_showing', 'coming_soon', 'draft']), releaseDate: calendarDate,
}).strict();
const cinemaFields = z.object({ slug, name: z.string().trim().min(1).max(200), city: z.string().trim().min(1).max(100), address: z.string().trim().min(1).max(1000), timezone: z.literal('Africa/Johannesburg'), active: z.boolean() }).strict();
const cinemaBody = cinemaFields.extend({ timezone: z.literal('Africa/Johannesburg').default('Africa/Johannesburg'), active: z.boolean().default(true) });
const experience = z.enum(['2D', '3D', 'Xtreme', 'VIP', '4DX']);
const auditoriumBody = z.object({ cinemaId: z.string().min(1).max(100), name: z.string().trim().min(1).max(100), experience, rows: z.number().int().min(1).max(26), seatsPerRow: z.number().int().min(1).max(50) }).strict();
const auditoriumPatch = z.object({ name: z.string().trim().min(1).max(100).optional(), experience: experience.optional() }).strict().refine(value => Object.keys(value).length > 0, 'Supply at least one property.');
const screeningFields = z.object({ movieId: z.string().min(1).max(100), auditoriumId: z.string().min(1).max(100), startsAt: timestamp, priceCents: z.number().int().min(1).max(1000000), status: z.enum(['scheduled', 'cancelled']) }).strict();
const screeningBody = screeningFields.extend({ status: z.enum(['scheduled', 'cancelled']).default('scheduled') });
const patch = <T extends z.ZodObject>(schema: T) => schema.partial().strict().refine(value => Object.keys(value).length > 0, 'Supply at least one property.');
const docs = (tag: string, summary: string, body?: z.ZodType) => ({ tags: [tag], summary, ...(body ? { body: z.toJSONSchema(body, { unrepresentable: 'any', io: 'input', target: 'draft-7' }) } : {}) });
const movieView = (r: Row) => ({ id: r.id, slug: r.slug, title: r.title, synopsis: r.synopsis, durationMinutes: r.duration_minutes, ageRating: r.age_rating, genre: r.genre, posterUrl: r.poster_url, status: r.status, releaseDate: r.release_date, createdAt: r.created_at });
const cinemaView = (r: Row) => ({ id: r.id, slug: r.slug, name: r.name, city: r.city, address: r.address, timezone: r.timezone, active: Boolean(r.active) });
const auditoriumView = (r: Row) => ({ id: r.id, cinemaId: r.cinema_id, name: r.name, experience: r.experience, ...(r.seat_count !== undefined ? { seatCount: r.seat_count } : {}) });
const screeningView = (r: Row) => ({ id: r.id, movieId: r.movie_id, auditoriumId: r.auditorium_id, cinemaId: r.cinema_id, startsAt: r.starts_at, endsAt: r.ends_at, priceCents: r.price_cents, currency: 'ZAR', status: r.status, movieTitle: r.movie_title, cinemaName: r.cinema_name, auditoriumName: r.auditorium_name, experience: r.experience });
const screeningJoin = `SELECT s.*, a.cinema_id, a.name auditorium_name, a.experience, c.name cinema_name, m.title movie_title
  FROM screenings s JOIN movies m ON m.id=s.movie_id JOIN auditoriums a ON a.id=s.auditorium_id JOIN cinemas c ON c.id=a.cinema_id`;

export async function registerCatalog(app: FastifyInstance, { db, config }: Context) {
  const now = () => new Date(config.clock()).toISOString();
  const get = (table: string, id: string) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Row | undefined;
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.');
    return row;
  };
  const audit = (request: FastifyRequest, action: string, entityId: string) => {
    db.prepare('INSERT INTO audit_logs (id,user_id,action,entity_id,details,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), request.user.sub, action, entityId, '{}', now());
  };
  const ensureSlug = (table: 'movies' | 'cinemas', value: string, excludeId = '') => {
    if (db.prepare(`SELECT 1 FROM ${table} WHERE slug=? AND id<>?`).get(value, excludeId)) throw new ApiError(409, 'SLUG_IN_USE', 'That slug is already in use.');
  };
  const hasCommitments = (screeningId: string) => !!db.prepare(`SELECT 1 WHERE EXISTS (
    SELECT 1 FROM holds WHERE screening_id=? AND status IN ('active','converted') AND expires_at>?
  ) OR EXISTS (SELECT 1 FROM bookings WHERE screening_id=? AND status='confirmed')`).get(screeningId, now(), screeningId);
  const scheduledInAuditorium = (auditoriumId: string) => !!db.prepare("SELECT 1 FROM screenings WHERE auditorium_id=? AND status='scheduled' AND ends_at>?").get(auditoriumId, now());
  const readScreening = (id: string) => {
    const row = db.prepare(`${screeningJoin} WHERE s.id=?`).get(id) as Row | undefined;
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Screening not found.');
    return screeningView(row);
  };
  const adminOptions = (summary: string, body?: z.ZodType) => ({ preHandler: app.requireAdmin, schema: { ...docs('Administration', summary, body), security: [{ bearerAuth: [] }] } });
  const paged = (table: string, where: string, args: (string | number)[], page: number, limit: number, orderBy: string, view: (row: Row) => unknown) => {
    const total = (db.prepare(`SELECT COUNT(*) total FROM ${table} ${where}`).get(...args) as Row).total;
    return { data: (db.prepare(`SELECT * FROM ${table} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit) as Row[]).map(view), pagination: { page, limit, total } };
  };

  app.get('/api/v1/movies', { schema: docs('Movies', 'Browse published movies; filter by search, status, or genre') }, async request => {
    const query = pagination.extend({ search: z.string().trim().max(100).optional(), status: z.enum(['now_showing', 'coming_soon']).optional(), genre: z.string().trim().max(100).optional() }).strict().parse(request.query);
    const clauses = ["status <> 'draft'"]; const args: (string | number)[] = [];
    if (query.search) { clauses.push("(title LIKE ? ESCAPE '\\' OR synopsis LIKE ? ESCAPE '\\')"); const term = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`; args.push(term, term); }
    if (query.status) { clauses.push('status=?'); args.push(query.status); }
    if (query.genre) { clauses.push('genre=? COLLATE NOCASE'); args.push(query.genre); }
    return paged('movies', `WHERE ${clauses.join(' AND ')}`, args, query.page, query.limit, 'release_date DESC,id', movieView);
  });
  app.get('/api/v1/movies/:id', { schema: docs('Movies', 'Get a published movie') }, async request => {
    const { id } = idParams.parse(request.params); const row = get('movies', id);
    if (row.status === 'draft') throw new ApiError(404, 'NOT_FOUND', 'Movie not found.');
    return { data: movieView(row) };
  });
  app.get('/api/v1/cinemas', { schema: docs('Cinemas', 'Browse active cinemas') }, async request => {
    const query = pagination.extend({ city: z.string().trim().max(100).optional() }).strict().parse(request.query);
    return paged('cinemas', query.city ? 'WHERE active=1 AND city=? COLLATE NOCASE' : 'WHERE active=1', query.city ? [query.city] : [], query.page, query.limit, 'name,id', cinemaView);
  });
  app.get('/api/v1/cinemas/:id', { schema: docs('Cinemas', 'Get a cinema and its auditoriums') }, async request => {
    const { id } = idParams.parse(request.params); const cinema = get('cinemas', id);
    if (!cinema.active) throw new ApiError(404, 'NOT_FOUND', 'Cinema not found.');
    const auditoriums = db.prepare('SELECT a.*, (SELECT COUNT(*) FROM seats WHERE auditorium_id=a.id) seat_count FROM auditoriums a WHERE cinema_id=? ORDER BY a.name').all(id) as Row[];
    return { data: { ...cinemaView(cinema), auditoriums: auditoriums.map(auditoriumView) } };
  });
  app.get('/api/v1/screenings', { schema: docs('Screenings', 'Browse upcoming screenings; date uses Africa/Johannesburg calendar days') }, async request => {
    const query = pagination.extend({ movieId: z.string().max(100).optional(), cinemaId: z.string().max(100).optional(), date: calendarDate.optional(), experience: experience.optional() }).strict().parse(request.query);
    const clauses = ["s.status='scheduled'", "m.status<>'draft'", 'c.active=1', 's.starts_at>?']; const args: (string | number)[] = [now()];
    if (query.movieId) { clauses.push('s.movie_id=?'); args.push(query.movieId); }
    if (query.cinemaId) { clauses.push('a.cinema_id=?'); args.push(query.cinemaId); }
    if (query.experience) { clauses.push('a.experience=?'); args.push(query.experience); }
    if (query.date) {
      const from = new Date(`${query.date}T00:00:00+02:00`).getTime();
      clauses.push('s.starts_at>=? AND s.starts_at<?'); args.push(new Date(from).toISOString(), new Date(from + 86400000).toISOString());
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) total FROM (${screeningJoin} ${where})`).get(...args) as Row).total;
    const rows = db.prepare(`${screeningJoin} ${where} ORDER BY s.starts_at,s.id LIMIT ? OFFSET ?`).all(...args, query.limit, (query.page - 1) * query.limit) as Row[];
    return { data: rows.map(screeningView), pagination: { page: query.page, limit: query.limit, total } };
  });
  app.get('/api/v1/screenings/:id', { schema: docs('Screenings', 'Get an upcoming screening') }, async request => {
    const { id } = idParams.parse(request.params);
    const row = db.prepare(`${screeningJoin} WHERE s.id=? AND s.status='scheduled' AND m.status<>'draft' AND c.active=1 AND s.starts_at>?`).get(id, now()) as Row | undefined;
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Upcoming screening not found.');
    return { data: screeningView(row) };
  });

  app.post('/api/v1/admin/movies', adminOptions('Create a movie', movieBody), async (request, reply) => {
    const body = movieBody.parse(request.body); const id = randomUUID();
    transaction(db, () => {
      ensureSlug('movies', body.slug);
      db.prepare('INSERT INTO movies (id,slug,title,synopsis,duration_minutes,age_rating,genre,poster_url,status,release_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, body.slug, body.title, body.synopsis, body.durationMinutes, body.ageRating, body.genre, body.posterUrl ?? null, body.status, body.releaseDate, now());
      audit(request, 'movie.created', id);
    });
    return reply.code(201).send({ data: movieView(get('movies', id)) });
  });
  const moviePatch = patch(movieBody);
  app.patch('/api/v1/admin/movies/:id', adminOptions('Update a movie; cancel scheduled screenings before changing runtime or unpublishing', moviePatch), async request => {
    const { id } = idParams.parse(request.params); const body = moviePatch.parse(request.body);
    transaction(db, () => {
      const existing = get('movies', id);
      if ((body.durationMinutes !== undefined && body.durationMinutes !== existing.duration_minutes) || (body.status === 'draft' && existing.status !== 'draft')) {
        if (db.prepare("SELECT 1 FROM screenings WHERE movie_id=? AND status='scheduled' AND ends_at>?").get(id, now())) throw new ApiError(409, 'SCREENINGS_EXIST', 'Cancel future screenings before changing the runtime or unpublishing this movie.');
      }
      if (body.slug) ensureSlug('movies', body.slug, id);
      const data = { ...movieView(existing), ...body };
      db.prepare('UPDATE movies SET slug=?,title=?,synopsis=?,duration_minutes=?,age_rating=?,genre=?,poster_url=?,status=?,release_date=? WHERE id=?').run(data.slug, data.title, data.synopsis, data.durationMinutes, data.ageRating, data.genre, data.posterUrl ?? null, data.status, data.releaseDate, id);
      audit(request, 'movie.updated', id);
    });
    return { data: movieView(get('movies', id)) };
  });
  app.post('/api/v1/admin/cinemas', adminOptions('Create a cinema', cinemaBody), async (request, reply) => {
    const body = cinemaBody.parse(request.body); const id = randomUUID();
    transaction(db, () => {
      ensureSlug('cinemas', body.slug);
      db.prepare('INSERT INTO cinemas (id,slug,name,city,address,timezone,active) VALUES (?,?,?,?,?,?,?)').run(id, body.slug, body.name, body.city, body.address, body.timezone, body.active ? 1 : 0);
      audit(request, 'cinema.created', id);
    });
    return reply.code(201).send({ data: cinemaView(get('cinemas', id)) });
  });
  const cinemaPatch = patch(cinemaFields);
  app.patch('/api/v1/admin/cinemas/:id', adminOptions('Update a cinema; cancel future screenings before deactivating', cinemaPatch), async request => {
    const { id } = idParams.parse(request.params); const body = cinemaPatch.parse(request.body);
    transaction(db, () => {
      const existing = get('cinemas', id);
      if (body.active === false && db.prepare("SELECT 1 FROM screenings s JOIN auditoriums a ON a.id=s.auditorium_id WHERE a.cinema_id=? AND s.status='scheduled' AND s.ends_at>?").get(id, now())) throw new ApiError(409, 'SCREENINGS_EXIST', 'Cancel future screenings before deactivating this cinema.');
      if (body.slug) ensureSlug('cinemas', body.slug, id);
      const data = { ...cinemaView(existing), ...body };
      db.prepare('UPDATE cinemas SET slug=?,name=?,city=?,address=?,timezone=?,active=? WHERE id=?').run(data.slug, data.name, data.city, data.address, data.timezone, data.active ? 1 : 0, id);
      audit(request, 'cinema.updated', id);
    });
    return { data: cinemaView(get('cinemas', id)) };
  });
  app.post('/api/v1/admin/auditoriums', adminOptions('Create an auditorium and a permanent rectangular seat layout', auditoriumBody), async (request, reply) => {
    const body = auditoriumBody.parse(request.body); const id = randomUUID();
    transaction(db, () => {
      const cinema = get('cinemas', body.cinemaId);
      if (!cinema.active) throw new ApiError(409, 'CINEMA_INACTIVE', 'The cinema must be active.');
      if (db.prepare('SELECT 1 FROM auditoriums WHERE cinema_id=? AND name=?').get(body.cinemaId, body.name)) throw new ApiError(409, 'AUDITORIUM_NAME_IN_USE', 'That auditorium name is already in use at this cinema.');
      db.prepare('INSERT INTO auditoriums (id,cinema_id,name,experience) VALUES (?,?,?,?)').run(id, body.cinemaId, body.name, body.experience);
      const insert = db.prepare('INSERT INTO seats (id,auditorium_id,row_label,number,kind) VALUES (?,?,?,?,?)');
      for (let row = 0; row < body.rows; row++) for (let number = 1; number <= body.seatsPerRow; number++) insert.run(randomUUID(), id, String.fromCharCode(65 + row), number, 'standard');
      audit(request, 'auditorium.created', id);
    });
    return reply.code(201).send({ data: { ...auditoriumView(get('auditoriums', id)), seatCount: body.rows * body.seatsPerRow } });
  });
  app.patch('/api/v1/admin/auditoriums/:id', adminOptions('Update auditorium name or experience; seat layouts are immutable', auditoriumPatch), async request => {
    const { id } = idParams.parse(request.params); const body = auditoriumPatch.parse(request.body);
    transaction(db, () => {
      const existing = get('auditoriums', id);
      if (body.experience && body.experience !== existing.experience && scheduledInAuditorium(id)) throw new ApiError(409, 'SCREENINGS_EXIST', 'Cancel future screenings before changing the auditorium experience.');
      if (body.name && db.prepare('SELECT 1 FROM auditoriums WHERE cinema_id=? AND name=? AND id<>?').get(existing.cinema_id, body.name, id)) throw new ApiError(409, 'AUDITORIUM_NAME_IN_USE', 'That auditorium name is already in use at this cinema.');
      db.prepare('UPDATE auditoriums SET name=?,experience=? WHERE id=?').run(body.name ?? existing.name, body.experience ?? existing.experience, id);
      audit(request, 'auditorium.updated', id);
    });
    return { data: auditoriumView(get('auditoriums', id)) };
  });
  const validateScreening = (body: z.infer<typeof screeningBody>, excludeId = '') => {
    const movie = get('movies', body.movieId); const auditorium = get('auditoriums', body.auditoriumId); const cinema = get('cinemas', auditorium.cinema_id);
    const start = Date.parse(body.startsAt);
    if (start <= config.clock()) throw new ApiError(400, 'SCREENING_IN_PAST', 'The screening must start in the future.');
    if (body.status === 'scheduled' && (!cinema.active || movie.status === 'draft')) throw new ApiError(409, 'RESOURCE_UNAVAILABLE', 'Publish the movie and activate the cinema before scheduling.');
    if (!db.prepare('SELECT 1 FROM seats WHERE auditorium_id=?').get(body.auditoriumId)) throw new ApiError(409, 'NO_SEATS', 'The auditorium has no configured seats.');
    const startsAt = new Date(start).toISOString(); const end = start + movie.duration_minutes * 60000; const endsAt = new Date(end).toISOString();
    if (body.status === 'scheduled' && db.prepare("SELECT 1 FROM screenings WHERE auditorium_id=? AND status='scheduled' AND id<>? AND starts_at<? AND ends_at>?").get(body.auditoriumId, excludeId, new Date(end + 20 * 60000).toISOString(), new Date(start - 20 * 60000).toISOString())) throw new ApiError(409, 'SCREENING_OVERLAP', 'The auditorium is occupied; allow 20 minutes between screenings.');
    return { startsAt, endsAt };
  };
  app.post('/api/v1/admin/screenings', adminOptions('Schedule a screening; runtime determines its end and prices are integer cents', screeningBody), async (request, reply) => {
    const body = screeningBody.parse(request.body); const id = randomUUID();
    transaction(db, () => {
      const { startsAt, endsAt } = validateScreening(body);
      db.prepare('INSERT INTO screenings (id,movie_id,auditorium_id,starts_at,ends_at,price_cents,status) VALUES (?,?,?,?,?,?,?)').run(id, body.movieId, body.auditoriumId, startsAt, endsAt, body.priceCents, body.status);
      audit(request, 'screening.created', id);
    });
    return reply.code(201).send({ data: readScreening(id) });
  });
  const screeningPatch = patch(screeningFields);
  app.patch('/api/v1/admin/screenings/:id', adminOptions('Update or cancel an unsold screening; confirmed bookings require a refund integration', screeningPatch), async request => {
    const { id } = idParams.parse(request.params); const body = screeningPatch.parse(request.body);
    transaction(db, () => {
      const existing = get('screenings', id);
      const cancelling = body.status === 'cancelled';
      const next = { movieId: existing.movie_id, auditoriumId: existing.auditorium_id, startsAt: existing.starts_at, priceCents: existing.price_cents, status: existing.status, ...body } as z.infer<typeof screeningBody>;
      if (cancelling && db.prepare("SELECT 1 FROM bookings WHERE screening_id=? AND status='confirmed'").get(id)) throw new ApiError(409, 'CONFIRMED_BOOKINGS_EXIST', 'Confirmed bookings must be refunded before this screening can be cancelled.');
      if (!cancelling && hasCommitments(id)) throw new ApiError(409, 'RESERVATIONS_EXIST', 'This screening has current reservations and cannot be changed.');
      if (cancelling && Object.keys(body).some(key => key !== 'status')) throw new ApiError(400, 'CANCELLATION_ONLY', 'Submit only status when cancelling a screening.');
      if (cancelling) {
        db.prepare("UPDATE holds SET status='released' WHERE screening_id=? AND status IN ('active','converted')").run(id);
        db.prepare("UPDATE bookings SET status='cancelled' WHERE screening_id=? AND status='pending'").run(id);
        db.prepare('DELETE FROM seat_claims WHERE screening_id=?').run(id);
        db.prepare("UPDATE screenings SET status='cancelled' WHERE id=?").run(id);
      } else {
        const { startsAt, endsAt } = validateScreening(next, id);
        db.prepare('UPDATE screenings SET movie_id=?,auditorium_id=?,starts_at=?,ends_at=?,price_cents=?,status=? WHERE id=?').run(next.movieId, next.auditoriumId, startsAt, endsAt, next.priceCents, next.status, id);
      }
      audit(request, cancelling ? 'screening.cancelled' : 'screening.updated', id);
    });
    return { data: readScreening(id) };
  });
}
