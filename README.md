# Twogether Budget

A shared budgeting site for trips and individual monthly finances. The backend is a small Node.js + Express API backed by SQLite (`server/`), which also serves the built frontend in production — one process, one deployment.

There is no authentication. This is a private, unlisted app shared between two people; anyone with the URL and knowledge of the two profile names (`Principessa`/`Principe`) can act as either. If that ever stops being acceptable, add a gate in front of it rather than reintroducing this decision lightly.

## Architecture

- `src/` — the frontend: every feature reads/writes shared state through `window.TwogetherAPI.{state, remoteState, post}`, set up by root `api.js`.
- `api.js` — implements that contract with plain `fetch()` calls to `/api/state` (read) and `/api/action` (write). In dev it points at `http://localhost:4310` (the local API server); in the production build it's same-origin.
- `server/` — the API: `server/src/core.js` holds all the business logic (validation, the shared-jar/trip-confirmation/award rules) as a pure, storage-agnostic module; `server/src/db/` stores state in SQLite; `server/src/index.js` is the Express app exposing `GET /api/state`, `GET /api/ping`, `POST /api/action`, and (in production) serves the built `dist/` frontend too.

## Run locally

```sh
npm install
npm --prefix server install
npm run dev
```

`npm run dev` starts the Vite dev server (frontend, hot reload, `:5180`) and the API server (`:4310`) together. Open `http://localhost:5180`.

To run just one side: `npm run dev:frontend` (Vite only) or `npm run server:dev` (API only, auto-restarts on change).

Run the test suite (exercises the action engine against a real temporary SQLite database):

```sh
npm test
```

## Deploying (Railway)

This repo is set up to deploy as **one Railway service** that builds the frontend and serves it alongside the API from a single process.

1. Create a Railway project from this GitHub repo. `railway.json` at the repo root tells Railway how to build (`npm ci && npm run build && npm --prefix server ci`) and start (`npm --prefix server start`) it — no manual configuration needed for that part.
2. Attach a **persistent Volume** to the service (e.g. mounted at `/data`) so the SQLite database survives redeploys, and set the env var `DATABASE_PATH=/data/twogether.db`. Without this, every redeploy starts with an empty database.
3. Optionally set `ALLOWED_ORIGIN` if you ever run the frontend from a different origin than the API (defaults cover local dev only). Not needed for the single-service setup above, since everything is same-origin in production.
4. Railway assigns a public URL once deployed — that's the whole app, frontend and API together.

Pushing to `main` (with Railway's GitHub integration enabled and auto-deploy on) rebuilds and redeploys automatically. This also means any tool with commit access to the repo — including an AI coding assistant working from a chat interface — can ship changes just by pushing; no separate deploy step.

## Project structure

- `src/` — frontend features, organized by category (`trips/`, `finances/`, `wishlist/`, `shop/`, `app/`, `lib/`).
- `api.js` — the frontend's API client (fetch-based).
- `server/` — the Node/Express/SQLite backend; has its own `package.json` and runs as its own process.
- `railway.json` — Railway build/deploy configuration for the combined single-service setup.
