# DataVista Analytics

Turn CSV and Excel datasets into validated, shareable visual reports — with dashboards, role-based access, live import notifications and forecasts that show their working.

Built from the six project documents in `uploads/`: PRD, TRD, UI/UX specification, application flow, database schema and implementation plan.

```
React + Vite + Tailwind  ──HTTPS/REST+WS──►  Express API  ──►  PostgreSQL (or embedded PGlite)
      (browser)                                  │
                                                 ├─►  private file storage (random keys)
                                                 └─►  Python analytics service (FastAPI/Pandas/sklearn)
```

The browser never touches the database, the file store or the analytics service. The Express API is the single authorization boundary.

---

## Quick start

### Option A — one command (recommended)

```bash
npm run install:all                 # frontend + backend dependencies
pip install -r services/analytics/requirements.txt
npm run dev                         # analytics → API → Vite, health-checked in order
```

Open **http://localhost:5173**.

`npm run dev` starts all three processes, waits for each health check, and prints the demo credentials. No database server is required: development uses PGlite (embedded PostgreSQL — same SQL, same constraints).

### Option B — separate terminals

```bash
# 1. analytics (port 8788)
cd services/analytics && uvicorn app.main:app --host 0.0.0.0 --port 8788

# 2. API (port 8787)
cd apps/api && cp .env.example .env && npm run dev

# 3. web (port 5173)
cd apps/web && cp .env.example .env && npm run dev
```

### Option C — Docker (production-shaped)

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
# → http://localhost:8080  (nginx → API + Socket.IO, PostgreSQL, analytics)
```

### Demo accounts

Seeded on first boot (set `AUTO_SEED=false` in production). Password for all: **`DataVista123`**.

| Email | Role | What they see |
|---|---|---|
| `super@datavista.dev` | Super admin | Everything, including admin-role grants |
| `admin@datavista.dev` | Admin | User management, all datasets, metrics |
| `analyst@datavista.dev` | Analyst | Upload, charts, dashboards, forecasts |
| `viewer@datavista.dev` | Viewer | Only the dashboard shared with them, read-only |

Seed data is clearly demonstration data (labelled accounts, synthetic sales and traffic rows). Every KPI on screen is computed live from the API — no hard-coded numbers.

---

## What's implemented

**Authentication & roles (PRD FR-01)** — register/login/logout, Argon2-grade bcrypt hashing, HttpOnly + SameSite session cookies, CSRF double-submit protection, per-request role resolution from the database, session revocation via `token_version`, password change that invalidates other sessions, audit logging.

**Datasets (FR-02)** — CSV/XLSX upload with extension + MIME + size + structure validation, asynchronous import jobs with explicit states and retry, paginated preview, column type inference, and quality warnings for missing values, duplicate rows, placeholders and type inconsistencies.

**Visualization (FR-03)** — bar, pie, line, area, scatter and histogram charts; field selection, aggregation (`sum/avg/count/count_distinct/min/max/median/none`), filters, titles; saved chart configurations; explicit loading, empty and error states.

**Dashboards (FR-04)** — create, rename, duplicate, delete; add/remove/reorder/resize widgets; persisted layout; private or explicitly shared with `view` / `edit`; viewer sees only what they may access.

**Real-time (FR-05)** — authenticated Socket.IO connections (session cookie handshake, one room per user), `dataset:processing`, `dataset:ready`, `dataset:failed`, `dashboard:refresh`, `forecast:ready/failed`; persisted notifications; reconnect re-sync from the REST API.

**Predictive analytics (FR-06)** — suitability checks before a run, chronological train/validation split, naive baseline always computed, candidate comparison, MAE/RMSE/MAPE/R², 95% prediction intervals, stored run history with warnings.

**Administration (FR-07)** — searchable/paginated user table, role changes, suspend/reactivate, audit trail, operational metrics, and guards against self-escalation, admin-on-admin edits and removing the last super admin.

---

## Repository layout

```
datavista/
├── apps/
│   ├── api/                    Express API
│   │   ├── src/
│   │   │   ├── app.js          middleware pipeline, route mounting
│   │   │   ├── index.js        server + Socket.IO bootstrap
│   │   │   ├── config.js       all configuration in one place
│   │   │   ├── db/             schema.sql, adapter (pg | pglite), seed
│   │   │   ├── lib/            auth, errors, validation, storage, analytics client,
│   │   │   │                   realtime, audit
│   │   │   ├── routes/         auth, datasets, charts, dashboards, analytics, admin
│   │   │   └── services/       business logic (datasets, dashboards, charts)
│   │   └── tests/              70 Vitest + Supertest tests
│   └── web/                    React SPA
│       ├── src/
│       │   ├── components/     AppShell, ChartView, ChartConfigPanel, DatasetUpload, ui kit
│       │   ├── context/        Auth, Toast, Realtime providers
│       │   ├── lib/            api client, formatters
│       │   └── pages/          Login, Register, Overview, Datasets, DatasetDetail,
│       │                       Explorer, ChartBuilder, Dashboards, DashboardView,
│       │                       Predictive, AdminUsers, AdminActivity, Settings
│       └── src/**/__tests__/   22 Vitest + Testing Library tests
├── services/analytics/         FastAPI service (internal)
│   ├── app/parsing.py          CSV/XLSX parse, schema inference, profiling
│   ├── app/query.py            aggregation engine
│   ├── app/forecasting.py      suitability, validation, models, intervals
│   └── tests/                  53 pytest tests
├── docs/                       architecture, API reference, security, testing, traceability
├── infra/nginx.conf            SPA + reverse proxy
├── Dockerfile.{api,analytics,web}
└── docker-compose.yml
```

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Full stack with health-gated startup |
| `npm run build` | Production SPA build |
| `npm test` | All suites (web, API, analytics) |
| `npm run test:api` | 70 API/authorization tests |
| `npm run test:web` | 22 component/unit tests |
| `npm run test:analytics` | 53 parsing/query/forecast tests |
| `npm run migrate` | Apply the schema |
| `npm run seed` | Re-seed demo data (`--force` to reset) |

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, data flow, key decisions
- [`docs/API.md`](docs/API.md) — every endpoint, payload and error contract
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model and controls
- [`docs/TESTING.md`](docs/TESTING.md) — test strategy and coverage
- [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) — requirement → implementation → test

## Production notes

Before deploying: set `JWT_SECRET` and `ANALYTICS_SERVICE_TOKEN` to random values, set `AUTO_SEED=false`, run `DB_DRIVER=pg` against managed PostgreSQL, put the API and analytics service on a private network (the analytics service trusts its service token, not the public internet), terminate TLS at the proxy, and replace `lib/storage.js` with S3-compatible storage using the same `storageKey` contract. See `docs/SECURITY.md` for the full checklist.
