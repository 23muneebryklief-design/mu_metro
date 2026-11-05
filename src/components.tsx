import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { api, ApiError, money, showDate, showTime } from "./api";
import type {
  Booking,
  Cinema,
  Movie,
  Screening,
  SeatMap,
  Session,
} from "./api";

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    film: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="1" />
        <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M7 12h10" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 22v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    phone: (
      <path d="M5 3h4l2 5-3 2c2 4 3 5 6 6l2-3 5 2v4c0 5-8 1-12-3S1 3 5 3Z" />
    ),
    chevron: <path d="m9 4 8 8-8 8" />,
    close: <path d="m5 5 14 14M19 5 5 19" />,
    menu: <path d="M3 6h18M3 12h18M3 18h18" />,
    check: <path d="m4 12 5 5L20 6" />,
    arrow: <path d="m5 12 7-7 7 7M12 5v16" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.film}
    </svg>
  );
}

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const box = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            onClose();
        }
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Notice({
  children,
  retry,
}: {
  children: ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="notice" role="alert">
      {children}
      {retry && (
        <button className="text-button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function AuthForm({
  onSession,
}: {
  onSession: (session: Session) => void;
}) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const { data } = await api<{
        user: Session["user"];
        accessToken: string;
        expiresIn: number;
      }>(`/auth/${register ? "register" : "login"}`, {
        method: "POST",
        body: {
          email: String(form.get("email")).trim(),
          password: form.get("password"),
          ...(register ? { name: String(form.get("name")).trim() } : {}),
        },
      });
      onSession({
        user: data.user,
        accessToken: data.accessToken,
        expiresAt: Date.now() + data.expiresIn * 1000,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-form">
      <div className="tabs">
        <button
          className={!register ? "active" : ""}
          onClick={() => {
            setRegister(false);
            setError("");
          }}
        >
          Sign in
        </button>
        <button
          className={register ? "active" : ""}
          onClick={() => {
            setRegister(true);
            setError("");
          }}
        >
          Create account
        </button>
      </div>
      <p>
        {register
          ? "A little closer to your next big-screen escape."
          : "Welcome back. Your next movie is waiting."}
      </p>
      <form onSubmit={submit}>
        {register && (
          <label>
            Your name
            <input name="name" autoComplete="name" required maxLength={100} />
          </label>
        )}
        <label>
          Email address
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={register ? 12 : 1}
            maxLength={128}
            required
          />
        </label>
        {register && <small>Use at least 12 characters.</small>}
        {error && <Notice>{error}</Notice>}
        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="fine-print">
        Development project account. Please use a unique password.
      </p>
    </div>
  );
}

export function Poster({ movie }: { movie: Movie }) {
  const [failed, setFailed] = useState(false);
  const reference =
    movie.id.startsWith("movie-reference-") && movie.posterUrl
      ? `/reference/${movie.posterUrl.split("/").pop()}`
      : movie.posterUrl;
  return reference && !failed ? (
    <img
      src={reference}
      alt={`${movie.title} poster`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className={`poster-placeholder poster-${movie.genre.toLowerCase().replaceAll(" ", "-")}`}
    >
      <Icon name="film" size={42} />
      <span>{movie.title}</span>
      <small>MU METRO · DEMO</small>
    </div>
  );
}

export function BookingFlow({
  screening,
  session,
  onSession,
  onClose,
  onBooked,
  initialBooking,
}: {
  screening: Screening;
  session: Session | null;
  onSession: (session: Session) => void;
  onClose: () => void;
  onBooked: () => void;
  initialBooking?: Booking;
}) {
  const [map, setMap] = useState<SeatMap | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(
    initialBooking || null,
  );
  const [remaining, setRemaining] = useState(0);
  const keys = useRef({
    selection: "",
    hold: crypto.randomUUID(),
    booking: crypto.randomUUID(),
    payment: crypto.randomUUID(),
    holdId: "",
  });
  const operation = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await api<SeatMap>(`/screenings/${screening.id}/seats`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setMap(result.data);
          setSelected((previous) =>
            previous.filter((id) =>
              result.data.seats.some(
                (s) => s.seatId === id && s.status === "available",
              ),
            ),
          );
        }
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message);
      }
    }
    if (!booking) void load();
    const interval = setInterval(() => {
      if (!booking && !operation.current) void load();
    }, 20000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [screening.id, booking]);

  useEffect(() => {
    if (!booking?.expiresAt) return;
    const update = () =>
      setRemaining(
        Math.max(
          0,
          Math.ceil((Date.parse(booking.expiresAt!) - Date.now()) / 1000),
        ),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [booking]);

  function toggle(id: string) {
    if (selected.includes(id))
      setSelected(selected.filter((value) => value !== id));
    else if (selected.length < 10) setSelected([...selected, id]);
    else setError("You can book up to 10 seats at a time.");
  }

  async function reserve() {
    if (!session || operation.current || !selected.length) return;
    operation.current = true;
    setBusy(true);
    setError("");
    const selection = [...selected].sort().join(",");
    if (keys.current.selection !== selection)
      keys.current = {
        selection,
        hold: crypto.randomUUID(),
        booking: crypto.randomUUID(),
        payment: crypto.randomUUID(),
        holdId: "",
      };
    try {
      if (!keys.current.holdId) {
        const hold = await api<{ id: string }>(`/holds`, {
          method: "POST",
          token: session.accessToken,
          key: keys.current.hold,
          body: { screeningId: screening.id, seatIds: selected },
        });
        keys.current.holdId = hold.data.id;
      }
      const result = await api<Booking>("/bookings", {
        method: "POST",
        token: session.accessToken,
        key: keys.current.booking,
        body: { holdId: keys.current.holdId },
      });
      // Idempotency replays may be stale: always read the current booking.
      const current = await api<Booking>(`/bookings/${result.data.id}`, {
        token: session.accessToken,
      });
      setBooking(current.data);
      onBooked();
    } catch (err) {
      setError((err as Error).message);
      if (
        err instanceof ApiError &&
        ["HOLD_INACTIVE", "SEAT_UNAVAILABLE", "INVALID_SEAT"].includes(err.code)
      ) {
        keys.current.selection = "";
        setSelected([]);
        const result = await api<SeatMap>(
          `/screenings/${screening.id}/seats`,
        ).catch(() => null);
        if (result) setMap(result.data);
      }
    } finally {
      setBusy(false);
      operation.current = false;
    }
  }
  async function pay() {
    if (!session || !booking || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await api<Booking>(`/bookings/${booking.id}/demo-payment`, {
        method: "POST",
        token: session.accessToken,
        key: keys.current.payment,
      });
      const current = await api<Booking>(`/bookings/${booking.id}`, {
        token: session.accessToken,
      });
      setBooking(current.data);
      onBooked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      operation.current = false;
    }
  }
  async function cancel() {
    if (!session || !booking || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/bookings/${booking.id}`, {
        method: "DELETE",
        token: session.accessToken,
      });
      onBooked();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      operation.current = false;
    }
  }
  const rows = [...new Set(map?.seats.map((s) => s.rowLabel))];
  return (
    <Dialog
      title={
        booking?.status === "confirmed"
          ? "Your demo booking is confirmed"
          : "Book your movie"
      }
      onClose={busy ? () => {} : onClose}
      wide
    >
      <div className="booking-summary">
        <h3>{screening.movieTitle}</h3>
        <p>
          {screening.cinemaName} · {screening.auditoriumName} ·{" "}
          <strong>{screening.experience}</strong>
        </p>
        <p>
          {showDate(screening.startsAt)} at {showTime(screening.startsAt)}
        </p>
      </div>
      {error && <Notice>{error}</Notice>}
      {booking ? (
        <div className="receipt">
          {booking.status === "confirmed" && (
            <div className="success-icon">
              <Icon name="check" size={32} />
            </div>
          )}
          <span className={`status status-${booking.status}`}>
            {booking.status}
          </span>
          <h3>{booking.reference}</h3>
          <p>
            Seats:{" "}
            {booking.seats.map((s) => `${s.rowLabel}${s.number}`).join(", ")}
          </p>
          <p className="total">{money(booking.totalCents)}</p>
          <p className="demo-message">
            Demonstration only. No money is charged and this is not a valid
            cinema ticket.
          </p>
          {booking.status === "pending" && (
            <>
              <p role="timer">
                {remaining
                  ? `Your seats are reserved for ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                  : "This reservation has expired. Choose another screening to book again."}
              </p>
              {session ? (
                <>
                  <button
                    className="primary"
                    disabled={busy || !remaining || !booking.isDemo}
                    onClick={pay}
                  >
                    {busy ? "Please wait…" : "Confirm demo payment"}
                  </button>
                  {!booking.isDemo && (
                    <p>Payments are not configured for this booking.</p>
                  )}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={cancel}
                  >
                    Cancel reservation
                  </button>
                </>
              ) : (
                <AuthForm onSession={onSession} />
              )}
            </>
          )}
          {booking.status !== "pending" && (
            <button className="primary" onClick={onClose}>
              Back to movies
            </button>
          )}
        </div>
      ) : (
        <>
          {!map ? (
            <Loading label="Loading available seats…" />
          ) : (
            <div className="seat-section">
              <h3>Choose your seats</h3>
              <div className="screen-line">SCREEN</div>
              <div className="seat-map" aria-label="Cinema seat map">
                {rows.map((row) => (
                  <div className="seat-row" key={row}>
                    <span>{row}</span>
                    <div>
                      {map.seats
                        .filter((s) => s.rowLabel === row)
                        .map((seat) => (
                          <button
                            key={seat.seatId}
                            className={`seat ${selected.includes(seat.seatId) ? "selected" : seat.status}`}
                            disabled={seat.status !== "available" || busy}
                            aria-label={`Seat ${seat.rowLabel}${seat.number}${seat.kind !== "standard" ? `, ${seat.kind}` : ""}, ${seat.status}`}
                            aria-pressed={selected.includes(seat.seatId)}
                            title={`${seat.rowLabel}${seat.number} · ${seat.kind}`}
                            onClick={() => toggle(seat.seatId)}
                          >
                            {seat.kind === "wheelchair" ? "♿" : seat.number}
                          </button>
                        ))}
                    </div>
                    <span>{row}</span>
                  </div>
                ))}
              </div>
              <div className="seat-legend">
                <span>
                  <i className="available" />
                  Available
                </span>
                <span>
                  <i className="selected" />
                  Selected
                </span>
                <span>
                  <i className="booked" />
                  Unavailable
                </span>
              </div>
              <div className="selection-summary">
                <span>
                  {selected.length
                    ? map.seats
                        .filter((s) => selected.includes(s.seatId))
                        .map((s) => `${s.rowLabel}${s.number}`)
                        .join(", ")
                    : "Select up to 10 seats"}
                </span>
                <strong>{money(selected.length * map.priceCents)}</strong>
              </div>
            </div>
          )}
          {!session ? (
            <div className="booking-auth">
              <h3>Sign in to reserve your seats</h3>
              <AuthForm onSession={onSession} />
            </div>
          ) : (
            <button
              className="primary"
              disabled={!selected.length || busy}
              onClick={reserve}
            >
              {busy ? "Reserving your seats…" : "Reserve seats & continue"}
            </button>
          )}
          <p className="fine-print">
            Seat availability and your final total are confirmed by the cinema
            service.
          </p>
        </>
      )}
    </Dialog>
  );
}

export function CinemaPicker({
  cinemas,
  selected,
  onSelect,
  onClose,
}: {
  cinemas: Cinema[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  return (
    <Dialog title="Change your cinema" onClose={onClose}>
      <div className="picker">
        <label className="search-field">
          <Icon name="search" />
          <input
            aria-label="Search cinemas"
            placeholder="Find your cinema or city"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button
          className={`cinema-option ${!selected ? "selected" : ""}`}
          onClick={() => {
            onSelect("");
            onClose();
          }}
        >
          <span>
            All cinemas<small>Explore every big-screen experience</small>
          </span>
          {!selected && <Icon name="check" />}
        </button>
        {cinemas
          .filter((c) =>
            `${c.name} ${c.city}`.toLowerCase().includes(search.toLowerCase()),
          )
          .map((c) => (
            <button
              className={`cinema-option ${selected === c.id ? "selected" : ""}`}
              key={c.id}
              onClick={() => {
                onSelect(c.id);
                onClose();
              }}
            >
              <Icon name="pin" />
              <span>
                {c.name}
                <small>
                  {c.city} · {c.address}
                </small>
              </span>
              {selected === c.id && <Icon name="check" />}
            </button>
          ))}
        {!cinemas.length && <p>No cinemas are available yet.</p>}
      </div>
    </Dialog>
  );
}
