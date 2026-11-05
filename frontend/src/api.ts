export type Movie = {
  id: string;
  slug: string;
  title: string;
  synopsis: string;
  durationMinutes: number;
  ageRating: string;
  genre: string;
  posterUrl: string | null;
  status: "now_showing" | "coming_soon";
  releaseDate: string;
};
export type Cinema = {
  id: string;
  name: string;
  city: string;
  address: string;
};
export type Screening = {
  id: string;
  movieId: string;
  cinemaId: string;
  movieTitle: string;
  cinemaName: string;
  auditoriumName: string;
  experience: string;
  startsAt: string;
  priceCents: number;
};
export type Seat = {
  seatId: string;
  rowLabel: string;
  number: number;
  kind: string;
  status: "available" | "held" | "booked";
};
export type SeatMap = {
  screeningId: string;
  priceCents: number;
  seats: Seat[];
};
export type Booking = {
  id: string;
  reference: string;
  screeningId: string;
  status: "pending" | "confirmed" | "cancelled";
  totalCents: number;
  expiresAt: string | null;
  isDemo: boolean;
  paymentMode: string;
  seats: { seatId: string; rowLabel: string; number: number }[];
};
export type Session = {
  user: { id: string; name: string; email: string };
  accessToken: string;
  expiresAt: number;
};
export type Envelope<T> = {
  data: T;
  pagination?: { total: number; page: number; limit: number };
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const base = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(
  /\/$/,
  "",
);
export function readSession(): Session | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem("mu-metro-session") || "null",
    ) as Session | null;
    return value && value.expiresAt > Date.now() ? value : null;
  } catch {
    return null;
  }
}
export function saveSession(session: Session | null) {
  if (session)
    sessionStorage.setItem("mu-metro-session", JSON.stringify(session));
  else sessionStorage.removeItem("mu-metro-session");
}

export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    key?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Envelope<T>> {
  // Retry network failures with the SAME idempotency key, never a fresh reservation.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${base}${path}`, {
        method: options.method || "GET",
        headers: {
          ...(options.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
          ...(options.key ? { "Idempotency-Key": options.key } : {}),
        },
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401 && options.token)
          window.dispatchEvent(new Event("session-expired"));
        throw new ApiError(
          result?.error?.message ||
            "The request could not be completed. Please try again.",
          response.status,
          result?.error?.code || "REQUEST_FAILED",
        );
      }
      if (!result || !("data" in result))
        throw new ApiError(
          "The cinema service returned an unexpected response.",
          502,
          "INVALID_RESPONSE",
        );
      return result as Envelope<T>;
    } catch (error) {
      if (error instanceof ApiError || options.signal?.aborted) throw error;
      if (options.key && attempt < 1) continue;
      throw new ApiError(
        "We could not reach the cinema service. Please check your connection and try again.",
        0,
        "NETWORK_ERROR",
      );
    }
  }
}

export async function allPages<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const result = await api<T[]>(`${path}${separator}limit=100&page=1`, {
    signal,
  });
  const pages = Math.ceil(
    (result.pagination?.total || result.data.length) / 100,
  );
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      api<T[]>(`${path}${separator}limit=100&page=${i + 2}`, { signal }),
    ),
  );
  return [...result.data, ...remaining.flatMap((page) => page.data)];
}

export const money = (cents: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    cents / 100,
  );
export const showTime = (date: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(date));
export const showDate = (date: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(date));
export const dateKey = (date: string) =>
  new Date(Date.parse(date) + 7200000).toISOString().slice(0, 10);
