import { useEffect, useRef, useState } from "react";
import {
  allPages,
  api,
  readSession,
  saveSession,
  money,
  showDate,
  showTime,
} from "./api";
import type { Booking, Cinema, Movie, Screening, Session } from "./api";
import {
  AuthForm,
  BookingFlow,
  CinemaPicker,
  Dialog,
  Icon,
  Loading,
  Notice,
  Poster,
} from "./components";
import { MovieDetail, MyBookings } from "./pages";
import "./App.css";

const nav = [
  ["/", "Home"],
  ["/now-showing", "Now Booking"],
  ["/coming-soon", "Coming Soon"],
  ["/cinemas", "Cinemas"],
  ["/prices", "Prices"],
  ["/partners", "Partners"],
  ["/about", "About Us"],
];
const promos = [
  ["1", "Ramayana: Rise of a Legend", "Ramayana"],
  ["2", "Godzilla Minus Zero", "Godzilla"],
  ["3", "Stray Kids World Tour Live Viewing", "Stray Kids"],
  ["4", "Ebenezer: A Christmas Carol", "Ebenezer"],
  ["5", "Discover your next movie", ""],
  ["7", "Prima Facie", "Prima Facie"],
];
const getRoute = () => window.location.hash.slice(1) || "/";

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [cinemas, setCinemas] = useState<Cinema[]>([]);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [session, setSession] = useState<Session | null>(readSession);
  const [sessionMessage, setSessionMessage] = useState("");
  const [cinema, setCinema] = useState(
    () => localStorage.getItem("mu-metro-cinema") || "",
  );
  const [picker, setPicker] = useState(false);
  const [auth, setAuth] = useState(false);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [experience, setExperience] = useState("");
  const [slide, setSlide] = useState(0);
  const [bookingShow, setBookingShow] = useState<Screening | null>(null);
  const [resumeBooking, setResumeBooking] = useState<Booking | undefined>();
  const [bookingsVersion, setBookingsVersion] = useState(0);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const change = () => {
      setRoute(getRoute());
      setMenu(false);
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- Reset state for the current resource request.
    setLoading(true);
    setError("");
    Promise.all([
      allPages<Movie>("/movies", controller.signal),
      allPages<Cinema>("/cinemas", controller.signal),
      allPages<Screening>("/screenings", controller.signal),
    ])
      .then(([films, places, shows]) => {
        if (!controller.signal.aborted) {
          setMovies(
            films.sort(
              (a, b) =>
                Number(Boolean(b.posterUrl)) - Number(Boolean(a.posterUrl)),
            ),
          );
          setCinemas(places);
          setScreenings(shows);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version]);
  useEffect(() => {
    if (!route.startsWith("/movie/")) {
      // oxlint-disable-next-line react/set-state-in-effect -- Reset state for the current resource request.
      setMovie(null);
      return;
    }
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- Reset state for the current resource request.
    setDetailLoading(true);
    // oxlint-disable-next-line react/set-state-in-effect -- Reset state for the current resource request.
    setMovie(null);
    api<Movie>(
      `/movies/${encodeURIComponent(decodeURIComponent(route.slice(7)))}`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (!controller.signal.aborted) setMovie(r.data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [route, version]);
  useEffect(() => {
    const expire = () => {
      saveSession(null);
      setSession(null);
      setSessionMessage(
        "Your session has ended. Please sign in again to continue.",
      );
    };
    window.addEventListener("session-expired", expire);
    const timer = session
      ? setTimeout(expire, Math.max(0, session.expiresAt - Date.now()))
      : undefined;
    if (session)
      api("/auth/me", { token: session.accessToken }).catch((err) => {
        if (err.status !== 401) setSessionMessage(err.message);
      });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("session-expired", expire);
    };
  }, [session]);
  function acceptSession(value: Session) {
    saveSession(value);
    setSession(value);
    setAuth(false);
    setSessionMessage("");
  }
  async function logout() {
    if (!session) return;
    try {
      await api("/auth/logout", { method: "POST", token: session.accessToken });
      saveSession(null);
      setSession(null);
    } catch (err) {
      setSessionMessage((err as Error).message);
    }
  }
  function chooseCinema(id: string) {
    setCinema(id);
    localStorage.setItem("mu-metro-cinema", id);
  }
  function openBooking(show: Screening, pending?: Booking) {
    setResumeBooking(pending);
    setBookingShow(show);
  }
  function findMovie(term = "") {
    setSearch(term);
    window.location.hash = "/now-showing";
    setTimeout(() => searchInput.current?.focus(), 0);
  }
  const selectedCinema = cinemas.find((c) => c.id === cinema);
  const shows = screenings.filter(
    (s) =>
      (!cinema || s.cinemaId === cinema) &&
      (!experience || s.experience === experience),
  );
  const status = route === "/coming-soon" ? "coming_soon" : "now_showing";
  const filterMovie = (m: Movie) =>
    (!cinema && !experience) || shows.some((s) => s.movieId === m.id);
  const currentMovies = movies.filter(
    (m) => m.status === "now_showing" && filterMovie(m),
  );
  const filtered = movies.filter(
    (m) =>
      m.status === status &&
      (!search ||
        `${m.title} ${m.genre} ${m.synopsis}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (status === "coming_soon" || filterMovie(m)),
  );
  function card(m: Movie) {
    const next = shows.find((s) => s.movieId === m.id);
    return (
      <button
        className="movie-card"
        key={m.id}
        onClick={() =>
          (window.location.hash = `/movie/${encodeURIComponent(m.id)}`)
        }
      >
        <div className="poster">
          <Poster movie={m} />
          <span className="poster-action">
            {m.status === "coming_soon" ? "View movie" : "Book now"}{" "}
            <Icon name="chevron" size={15} />
          </span>
        </div>
        <div className="movie-card-info">
          <h3>{m.title}</h3>
          <p>{m.genre}</p>
          <p>
            {m.durationMinutes} min. <span className="divider">|</span>{" "}
            {m.ageRating}
          </p>
          {next && (
            <p className="next-show">
              Next show: <strong>{showTime(next.startsAt)}</strong>
              <small>{showDate(next.startsAt)}</small>
            </p>
          )}
          {m.status === "coming_soon" && (
            <p className="next-show">
              Opens {showDate(`${m.releaseDate}T12:00:00+02:00`)}
            </p>
          )}
          <div className="experience-tags">
            {[
              ...new Set(
                shows
                  .filter((s) => s.movieId === m.id)
                  .map((s) => s.experience),
              ),
            ].map((x) => (
              <span className={`tag tag-${x.toLowerCase()}`} key={x}>
                {x}
              </span>
            ))}
          </div>
        </div>
      </button>
    );
  }
  const cinemaControl = (
    <button className="cinema-selector" onClick={() => setPicker(true)}>
      <Icon name="pin" size={16} />
      {selectedCinema?.name || "Choose a cinema"}
      <span>⌄</span>
    </button>
  );
  return (
    <>
      <a
        className="skip-link"
        href="#content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("content")?.focus();
        }}
      >
        Skip to content
      </a>
      <header>
        <div className="topbar">
          <div className="container">
            <a className="phone" href="tel:0861246362">
              <Icon name="phone" size={14} />
              086 124 6362
            </a>
            <div className="topbar-right">
              <button
                className="account-button"
                onClick={() =>
                  session ? (window.location.hash = "/bookings") : setAuth(true)
                }
              >
                <Icon name="user" size={15} />
                {session?.user.name || "Sign in"}
              </button>
              <button className="header-search" onClick={() => findMovie()}>
                Find a movie <Icon name="search" size={15} />
              </button>
            </div>
          </div>
        </div>
        <div className="nav-skin">
          <div className="container nav-inner">
            <a className="brand" href="#/" aria-label="Nu Metro home">
              <img src="/reference/nu_metro_logo_orange.png" alt="Nu Metro" />
            </a>
            <button
              className="menu-button"
              aria-label="Toggle navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Icon name={menu ? "close" : "menu"} size={26} />
            </button>
            <nav aria-label="Main navigation" className={menu ? "open" : ""}>
              {nav.map(([path, title]) => (
                <a
                  key={path}
                  href={`#${path}`}
                  className={route === path ? "active" : ""}
                >
                  {title}
                </a>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <main id="content" tabIndex={-1}>
        {sessionMessage && (
          <div className="container">
            <Notice>
              {sessionMessage}{" "}
              {!session && (
                <button className="text-button" onClick={() => setAuth(true)}>
                  Sign in
                </button>
              )}
            </Notice>
          </div>
        )}
        {route === "/" && (
          <section className="promotion-section" aria-label="Featured movies">
            <div className="promotion-pair">
              {[0, 1].map((offset) => {
                const promo = promos[(slide + offset) % promos.length];
                return (
                  <button
                    className="promotion"
                    key={offset}
                    onClick={() => findMovie(promo[2])}
                  >
                    <img
                      src={`/reference/banner-${promo[0]}.jpg`}
                      alt={promo[1]}
                      fetchPriority="high"
                    />
                  </button>
                );
              })}
            </div>
            <button
              className="hero-arrow hero-prev"
              aria-label="Previous promotion"
              onClick={() =>
                setSlide((slide + promos.length - 1) % promos.length)
              }
            >
              <Icon name="chevron" size={54} />
            </button>
            <button
              className="hero-arrow hero-next"
              aria-label="Next promotion"
              onClick={() => setSlide((slide + 1) % promos.length)}
            >
              <Icon name="chevron" size={54} />
            </button>
            <div className="slider-dots">
              {promos.map((p, i) => (
                <button
                  key={p[0]}
                  aria-label={`Show promotion ${i + 1}`}
                  aria-current={slide === i}
                  onClick={() => setSlide(i)}
                />
              ))}
            </div>
          </section>
        )}
        {error && (
          <div className="container">
            <Notice retry={() => setVersion(version + 1)}>{error}</Notice>
          </div>
        )}
        {route === "/" ? (
          <>
            <div className="container home-heading">
              <h1>
                Book a movie at <strong>Nu Metro</strong>
              </h1>
              {cinemaControl}
            </div>
            {loading ? (
              <Loading label="Loading movies…" />
            ) : currentMovies.length ? (
              <section className="movie-carousel" aria-label="Now booking">
                <div className="movie-track" ref={track}>
                  {currentMovies.map(card)}
                </div>
                <button
                  className="carousel-arrow carousel-prev"
                  aria-label="Previous movies"
                  onClick={() =>
                    track.current?.scrollBy({
                      left: -track.current.clientWidth * 0.65,
                      behavior: "smooth",
                    })
                  }
                >
                  <Icon name="chevron" size={34} />
                </button>
                <button
                  className="carousel-arrow carousel-next"
                  aria-label="Next movies"
                  onClick={() =>
                    track.current?.scrollBy({
                      left: track.current.clientWidth * 0.65,
                      behavior: "smooth",
                    })
                  }
                >
                  <Icon name="chevron" size={34} />
                </button>
              </section>
            ) : (
              <div className="container empty">
                <h2>No movies to show just yet</h2>
                <p>Try another cinema or check back soon.</p>
              </div>
            )}
            <section className="quick-actions container">
              <h2>
                <span>OR</span>
              </h2>
              <div>
                <button onClick={() => setPicker(true)}>
                  <Icon name="pin" size={49} />
                  <span>
                    Choose a <strong>cinema</strong>
                  </span>
                </button>
                <button onClick={() => findMovie()}>
                  <Icon name="film" size={49} />
                  <span>
                    Find a <strong>movie</strong>
                  </span>
                </button>
                <a href="#/experiences">
                  <img src="/reference/nstar.svg" alt="" />
                  <span>
                    Choose an <strong>experience</strong>
                  </span>
                </a>
              </div>
            </section>
          </>
        ) : route.startsWith("/movie/") ? (
          <div className="container page-content">
            {detailLoading ? (
              <Loading label="Loading movie…" />
            ) : (
              movie && (
                <MovieDetail
                  movie={movie}
                  cinemas={cinemas}
                  screenings={screenings.filter((s) => s.movieId === movie.id)}
                  cinema={cinema}
                  onCinema={chooseCinema}
                  onBook={openBooking}
                />
              )
            )}
          </div>
        ) : ["/now-showing", "/coming-soon"].includes(route) ? (
          <section className="container page-content">
            <div className="page-title">
              <h1>
                {status === "coming_soon" ? "Coming" : "Now"}{" "}
                <strong>{status === "coming_soon" ? "Soon" : "Booking"}</strong>
              </h1>
              {cinemaControl}
            </div>
            <div className="catalogue-filters">
              <label className="search-field">
                <Icon name="search" />
                <input
                  ref={searchInput}
                  aria-label="Find a movie"
                  placeholder="Find a movie"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                  >
                    <Icon name="close" size={17} />
                  </button>
                )}
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
            {loading ? (
              <Loading />
            ) : (
              <>
                <p className="results-count">
                  {filtered.length} {filtered.length === 1 ? "movie" : "movies"}
                </p>
                <div className="movie-grid">{filtered.map(card)}</div>
                {!filtered.length && (
                  <div className="empty">
                    <h2>No movies found</h2>
                    <p>Try a different search or cinema.</p>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSearch("");
                        setExperience("");
                        chooseCinema("");
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        ) : route === "/cinemas" ? (
          <section className="container page-content">
            <h1>
              Choose a <strong>cinema</strong>
            </h1>
            <p className="page-intro">Find your next big-screen escape.</p>
            {loading ? (
              <Loading />
            ) : (
              <div className="cinema-grid">
                {cinemas.map((c) => (
                  <article className="cinema-card" key={c.id}>
                    <div className="cinema-illustration">
                      <Icon name="film" size={62} />
                      <span>{c.city}</span>
                    </div>
                    <div>
                      <h2>{c.name}</h2>
                      <p>{c.address}</p>
                      <button
                        className="primary"
                        onClick={() => {
                          chooseCinema(c.id);
                          window.location.hash = "/now-showing";
                        }}
                      >
                        View movies & showtimes
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : route === "/experiences" ? (
          <section className="container page-content">
            <h1>
              Choose an <strong>experience</strong>
            </h1>
            <p className="page-intro">
              There is more than one way to experience the movies.
            </p>
            <div className="experience-grid">
              {[
                ["2D", "The classic cinema experience."],
                ["3D", "A new dimension of movie magic."],
                ["Xtreme", "Big screens. Bigger sound."],
                ["VIP", "Make a little more of movie night."],
                ["4DX", "Feel part of the action."],
              ].map(([x, desc]) => (
                <button
                  className={`experience-card experience-${x.toLowerCase()}`}
                  key={x}
                  onClick={() => {
                    setExperience(x);
                    setSearch("");
                    window.location.hash = "/now-showing";
                  }}
                >
                  <span>{x}</span>
                  <p>{desc}</p>
                  <small>
                    Find movies <Icon name="chevron" size={16} />
                  </small>
                </button>
              ))}
            </div>
          </section>
        ) : route === "/bookings" ? (
          <section className="container page-content">
            <div className="page-title">
              <h1>
                My <strong>bookings</strong>
              </h1>
              {session && (
                <button className="text-button" onClick={logout}>
                  Sign out
                </button>
              )}
            </div>
            {session ? (
              <MyBookings
                key={`${session.user.id}-${bookingsVersion}`}
                session={session}
                onResume={openBooking}
                screenings={screenings}
              />
            ) : (
              <div className="standalone-auth">
                <AuthForm onSession={acceptSession} />
              </div>
            )}
          </section>
        ) : route === "/prices" ? (
          <section className="container page-content">
            <h1>
              Movie <strong>prices</strong>
            </h1>
            <p className="page-intro">
              Prices from upcoming screenings. Your final total is confirmed
              before checkout.
            </p>
            {cinemaControl}
            <div className="price-list">
              {cinemas
                .filter((c) => !cinema || c.id === cinema)
                .map((c) => (
                  <article key={c.id}>
                    <h2>{c.name}</h2>
                    {[
                      ...new Set(
                        screenings
                          .filter((s) => s.cinemaId === c.id)
                          .map((s) => s.experience),
                      ),
                    ].map((x) => (
                      <p key={x}>
                        <span>{x}</span>
                        <strong>
                          From{" "}
                          {money(
                            Math.min(
                              ...screenings
                                .filter(
                                  (s) =>
                                    s.cinemaId === c.id && s.experience === x,
                                )
                                .map((s) => s.priceCents),
                            ),
                          )}
                        </strong>
                      </p>
                    ))}
                    <button
                      className="text-button"
                      onClick={() => {
                        chooseCinema(c.id);
                        window.location.hash = "/now-showing";
                      }}
                    >
                      Find a movie →
                    </button>
                  </article>
                ))}
            </div>
          </section>
        ) : route === "/partners" ? (
          <section className="container page-content text-page">
            <h1>
              Movie <strong>partners</strong>
            </h1>
            <p>
              Nu Metro's official partner benefits and promotions are available
              on the original website.
            </p>
            <p>
              This independent project uses demonstration inventory and does not
              apply partner discounts or loyalty points.
            </p>
            <a
              className="primary link-button"
              href="https://numetro.co.za/partners/"
              target="_blank"
              rel="noreferrer"
            >
              Visit official Nu Metro partners ↗
            </a>
          </section>
        ) : route === "/about" ? (
          <section className="container page-content text-page">
            <h1>
              About this <strong>project</strong>
            </h1>
            <p>
              A React cinema experience with the look and feel of Nu Metro,
              connected to the Mu Metro catalogue and reservation API.
            </p>
            <p>
              This is an independent development project. Cinemas and showtimes
              are demonstration data. Demo confirmations do not charge money or
              issue valid tickets.
            </p>
            <p>
              For official screenings and bookings, visit{" "}
              <a href="https://numetro.co.za/" target="_blank" rel="noreferrer">
                numetro.co.za
              </a>
              .
            </p>
          </section>
        ) : (
          <section className="container page-content empty">
            <h1>Page not found</h1>
            <a className="primary link-button" href="#/">
              Back to home
            </a>
          </section>
        )}
      </main>
      <footer>
        <button
          className="back-top"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <Icon name="arrow" size={25} />
        </button>
        <div className="container footer-main">
          <div className="footer-brand">
            <a href="#/">
              <img src="/reference/nu_metro_logo_orange.png" alt="Nu Metro" />
            </a>
            <a href="tel:0861246362">
              <Icon name="phone" size={17} />
              086 124 6362
            </a>
            <div className="social-links">
              {[
                ["f", "Facebook", "https://facebook.com/numetro"],
                ["𝕏", "X", "https://twitter.com/numetro"],
                ["▶", "YouTube", "https://youtube.com/numetro"],
                ["◎", "Instagram", "https://instagram.com/numetro"],
              ].map(([symbol, label, href]) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  target="_blank"
                  rel="noreferrer"
                >
                  {symbol}
                </a>
              ))}
            </div>
          </div>
          <div>
            <h3>Quick Links</h3>
            {[
              ["Terms and Conditions", "terms-and-conditions"],
              ["Privacy Policy", "privacy-policy"],
              ["Contact Us", "contact"],
              ["Website FAQs", "website-faqs"],
            ].map(([label, path]) => (
              <a
                key={path}
                href={`https://numetro.co.za/${path}/`}
                target="_blank"
                rel="noreferrer"
              >
                {label} ↗
              </a>
            ))}
            <a href="#/about">About this project</a>
          </div>
          <div>
            <h3>Movies</h3>
            <a href="#/now-showing">Now Showing</a>
            <a href="#/coming-soon">Showing Soon</a>
            <button onClick={() => findMovie()}>Find a movie</button>
          </div>
          <div className="footer-discover">
            <a href="#/cinemas">Choose a cinema</a>
            <a href="#/experiences">Choose an experience</a>
            <a href="#/bookings">My bookings</a>
          </div>
        </div>
        <div className="footer-bottom container">
          <span>
            Independent development project · Demo inventory & payments
          </span>
          <span>Visual reference: Nu Metro</span>
        </div>
      </footer>
      {picker && (
        <CinemaPicker
          cinemas={cinemas}
          selected={cinema}
          onSelect={chooseCinema}
          onClose={() => setPicker(false)}
        />
      )}
      {auth && (
        <Dialog
          title="Your movie experience starts here"
          onClose={() => setAuth(false)}
        >
          <AuthForm onSession={acceptSession} />
        </Dialog>
      )}
      {bookingShow && (
        <BookingFlow
          key={resumeBooking?.id || bookingShow.id}
          screening={bookingShow}
          initialBooking={resumeBooking}
          session={session}
          onSession={acceptSession}
          onClose={() => {
            setBookingShow(null);
            setResumeBooking(undefined);
            setVersion((v) => v + 1);
          }}
          onBooked={() => setBookingsVersion((v) => v + 1)}
        />
      )}
    </>
  );
}
