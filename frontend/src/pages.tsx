import { useEffect, useState } from "react";
import { api, dateKey, money, showDate, showTime } from "./api";
import type { Booking, Cinema, Movie, Screening, Session } from "./api";
import { Icon, Loading, Notice, Poster } from "./components";

export function MovieDetail({
  movie,
  cinemas,
  screenings,
  cinema,
  onCinema,
  onBook,
}: {
  movie: Movie;
  cinemas: Cinema[];
  screenings: Screening[];
  cinema: string;
  onCinema: (id: string) => void;
  onBook: (s: Screening) => void;
}) {
  const [date, setDate] = useState("");
  const [experience, setExperience] = useState("");
  const filtered = screenings.filter(
    (s) =>
      (!cinema || s.cinemaId === cinema) &&
      (!experience || s.experience === experience),
  );
  const dates = [...new Set(filtered.map((s) => dateKey(s.startsAt)))].sort();
  const activeDate = dates.includes(date) ? date : dates[0] || "";
  const available = filtered.filter((s) => dateKey(s.startsAt) === activeDate);
  return (
    <>
      <a
        className="back-link"
        href={
          movie.status === "coming_soon" ? "#/coming-soon" : "#/now-showing"
        }
      >
        ← Back to movies
      </a>
      <div className="movie-detail">
        <div className="detail-poster">
          <Poster movie={movie} />
        </div>
        <div>
          <p className="eyebrow">
            {movie.status === "coming_soon" ? "COMING SOON" : "NOW BOOKING"}
          </p>
          <h1>{movie.title}</h1>
          <div className="movie-meta">
            <span className="rating">{movie.ageRating}</span>
            <span>{movie.durationMinutes} min.</span>
            <span>{movie.genre}</span>
          </div>
          <p className="synopsis">{movie.synopsis}</p>
          <p>Release date: {showDate(`${movie.releaseDate}T12:00:00+02:00`)}</p>
          <div className="detail-experiences">
            {[...new Set(screenings.map((s) => s.experience))].map((x) => (
              <span className={`tag tag-${x.toLowerCase()}`} key={x}>
                {x}
              </span>
            ))}
          </div>
        </div>
      </div>
      <section className="showtimes">
        <h2>
          Book your <strong>tickets</strong>
        </h2>
        <div className="showtime-filters">
          <label>
            Cinema
            <select value={cinema} onChange={(e) => onCinema(e.target.value)}>
              <option value="">All cinemas</option>
              {cinemas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Experience
            <select
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
            >
              <option value="">All experiences</option>
              {["2D", "3D", "Xtreme", "VIP", "4DX"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="date-strip" aria-label="Screening dates">
          {dates.map((d) => (
            <button
              key={d}
              className={d === activeDate ? "active" : ""}
              onClick={() => setDate(d)}
            >
              {showDate(`${d}T12:00:00+02:00`)}
            </button>
          ))}
        </div>
        {!available.length && (
          <div className="empty">
            <h3>
              {movie.status === "coming_soon"
                ? "Something to look forward to"
                : "No upcoming showtimes"}
            </h3>
            <p>
              {movie.status === "coming_soon"
                ? "Bookings will open closer to release. Check back soon."
                : "Try a different cinema or experience, or check back for new showtimes."}
            </p>
          </div>
        )}
        {[...new Set(available.map((s) => s.cinemaId))].map((id) => (
          <div className="cinema-shows" key={id}>
            <h3>
              <Icon name="pin" size={18} />
              {cinemas.find((c) => c.id === id)?.name}
            </h3>
            <div>
              {available
                .filter((s) => s.cinemaId === id)
                .map((s) => (
                  <button
                    className="showtime-button"
                    key={s.id}
                    onClick={() => onBook(s)}
                  >
                    <strong>{showTime(s.startsAt)}</strong>
                    <span>
                      {s.experience} · {s.auditoriumName}
                    </span>
                    <small>{money(s.priceCents)}</small>
                  </button>
                ))}
            </div>
          </div>
        ))}
        <p className="fine-print">
          All showtimes are in South African time. Demonstration screenings
          only.
        </p>
      </section>
    </>
  );
}

export function MyBookings({
  session,
  onResume,
  screenings,
}: {
  session: Session;
  onResume: (s: Screening, b: Booking) => void;
  screenings: Screening[];
}) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [version, setVersion] = useState(0);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- Reset state for the current resource request.
    setLoading(true);
    setError("");
    api<Booking[]>(`/bookings?limit=10&page=${page}`, {
      token: session.accessToken,
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) {
          setBookings(r.data);
          setTotal(r.pagination?.total || 0);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session.accessToken, page, version]);
  async function cancel(id: string) {
    setBusy(id);
    setError("");
    try {
      await api(`/bookings/${id}`, {
        method: "DELETE",
        token: session.accessToken,
      });
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      {error && <Notice retry={() => setVersion((v) => v + 1)}>{error}</Notice>}
      {loading ? (
        <Loading label="Loading your bookings…" />
      ) : !bookings.length ? (
        <div className="empty">
          <Icon name="film" size={44} />
          <h2>Your next movie awaits</h2>
          <p>You haven't made any bookings yet.</p>
          <a className="primary link-button" href="#/now-showing">
            Find a movie
          </a>
        </div>
      ) : (
        <div className="bookings-list">
          {bookings.map((b) => {
            const s = screenings.find((show) => show.id === b.screeningId);
            const active =
              b.status === "pending" &&
              b.expiresAt &&
              Date.parse(b.expiresAt) > clock;
            return (
              <article key={b.id}>
                <div>
                  <span className={`status status-${b.status}`}>
                    {b.status}
                  </span>
                  <h2>{s?.movieTitle || "Cinema booking"}</h2>
                  <p>
                    {s
                      ? `${s.cinemaName} · ${showDate(s.startsAt)} · ${showTime(s.startsAt)}`
                      : "Historical screening"}
                  </p>
                  <p>
                    Seats:{" "}
                    {b.seats
                      .map((seat) => `${seat.rowLabel}${seat.number}`)
                      .join(", ")}
                  </p>
                  <small>{b.reference}</small>
                </div>
                <div>
                  <strong>{money(b.totalCents)}</strong>
                  {active && (
                    <>
                      {s && (
                        <button
                          className="primary"
                          onClick={() => onResume(s, b)}
                        >
                          Continue booking
                        </button>
                      )}
                      <button
                        className="text-button"
                        disabled={busy === b.id}
                        onClick={() => cancel(b.id)}
                      >
                        Cancel reservation
                      </button>
                    </>
                  )}
                  {b.isDemo && <small>Demo booking · Not a valid ticket</small>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {total > 10 && (
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {Math.ceil(total / 10)}
          </span>
          <button
            disabled={page * 10 >= total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
