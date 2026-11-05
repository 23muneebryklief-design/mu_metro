# Mu Metro frontend

React + TypeScript with Vite. Requires Node.js 24 LTS, matching the backend.

## Development

From this directory:

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Start the backend separately from the repository root using the root README instructions. Vite proxies relative `/api` and `/health` requests to http://127.0.0.1:3000; use paths such as `/api/v1/movies` when adding API calls.

## Checks and production build

```sh
npm run lint
npm run build
npm run preview
```

The build outputs static assets to `dist/`. The development proxy does not apply to preview or production: configure your production web server to forward `/api` to the backend. Never put secrets in browser code or `VITE_` environment variables.

This is an independent development project. The initial screen is a starter; booking and authentication screens are not implemented.
