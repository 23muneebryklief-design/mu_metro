# Mu Metro frontend

This branch contains only the React + TypeScript + Vite frontend. The application lives at the repository root; there is no nested `frontend/` folder. The separate Fastify/SQLite backend is on the `main` branch.

## Run the frontend

Requires Node.js 24 LTS. From this checkout's root:

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Run the backend in another checkout and terminal, as shown below. The frontend proxies `/api` and `/health` to http://127.0.0.1:3000. If the API is stopped, movie browsing and bookings display a connection error; there is no fake catalogue fallback.

To change the API target or frontend port, copy `.env.example` to `.env` and edit `API_PROXY_TARGET` or `FRONTEND_PORT`. Both `npm run dev` and `npm run preview` use the configured API proxy.

## Run the backend separately

Keep each branch in its own directory so dependencies and environment files do not conflict. For example:

```sh
git clone --branch main --single-branch https://github.com/23muneebryklief-design/mu_metro.git ../mu_metro-backend
cd ../mu_metro-backend
npm ci
npm run setup
npm run db:seed:reference
npm run dev
```

Leave that terminal running. In this frontend checkout, run `npm run dev` in a second terminal. The backend seed command adds the optional film catalogue and fictional screenings used by the interface. `npm run db:seed` instead loads the original three-film demonstration catalogue. Backend setup, seeding, database and payment configuration belong to `main`; they are not frontend scripts.

## Build and preview

```sh
npm run lint
npm run build
npm run preview
```

Vite prints the preview URL, usually http://localhost:4173. Keep the API running to test the built application. `dist/` contains the deployable static frontend; it is not committed.

For deployment, serve `dist/` and proxy `/api` to your backend. Alternatively, set `VITE_API_BASE_URL` to your public API URL **before building**, and configure that frontend origin in the backend's `CORS_ORIGINS`. There is no backend server or combined Docker image in this branch. Never put secrets in `VITE_` environment variables.

## Connected features

Movie catalogue and search, cinema and experience filters, movie details, South African showtimes, registration and sign-in, live seat maps, reservations, demo checkout, cancellation and booking history all use the API. The server controls availability and prices. Session tokens expire after 15 minutes; passwords are not saved.

This is an independent development project with visuals based on https://numetro.co.za/. Demo payments do not charge money or issue valid cinema tickets. Official partner discounts and real Nu Metro inventory are not integrated. See [reference artwork provenance](public/reference/README.md).
