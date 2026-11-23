# DataVista Analytics — build summary

Implementation of the six project documents (PRD, TRD, UI/UX spec, AppFlow, database schema, implementation plan), delivered as a running full-stack application.

## Status

| | |
|---|---|
| Running locally | ✅ API :8787 · Analytics :8788 · Web :5173 |
| Automated tests | ✅ **148 passing** — 70 API · 53 analytics · 22 frontend · 3 E2E journeys |
| Production build | ✅ `npm run build` succeeds |
| Deployment | ✅ Docker (3 images) + compose, nginx, CI workflow |
| Documentation | ✅ 5 documents, 13,900 lines of code and docs |

## Stack (as specified in the TRD)

- **Frontend** — React 18, Vite, Tailwind CSS, Recharts, Socket.IO client
- **API** — Node 20, Express, Socket.IO, bcrypt, JWT sessions, zod validation, Helmet, rate limiting
- **Database** — PostgreSQL (PGlite embedded for zero-setup dev, `pg` driver in production; identical schema and SQL)
- **Analytics** — Python 3.12, FastAPI, Pandas, NumPy, scikit-learn (internal service, service-token authenticated)
- **Storage** — private local directory with random keys behind an S3-swappable interface

## Every functional requirement is implemented

| PRD | Delivered |
|---|---|
| FR-01 Auth & roles | Register/login/logout, bcrypt, HttpOnly+SameSite cookies, CSRF double-submit, per-request role resolution, instant session revocation, audit log |
| FR-02 Datasets | CSV/XLSX upload with extension+MIME+size+structure validation, async import jobs with retry, paginated preview, type inference, quality warnings |
| FR-03 Visualization | Bar/pie/line (+area/scatter/histogram), field selection, 8 aggregations, filters, saved configurations, loading/empty/error states |
| FR-04 Dashboards | Create/rename/duplicate/delete, add/move/resize widgets, persisted layout, private + explicit `view`/`edit` sharing |
| FR-05 Real-time | Authenticated Socket.IO, 6 event types, persisted notifications, reconnect re-sync |
| FR-06 Predictive | Suitability checks, chronological validation split, naive baseline always compared, MAE/RMSE/MAPE/R², 95% intervals, stored history |
| FR-07 Administration | User list/search/roles/suspend, audit trail, metrics, self-escalation and last-super-admin guards |

Full requirement-by-requirement mapping: [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md).

## Getting started

```bash
cd datavista
npm run install:all
pip install -r services/analytics/requirements.txt
npm run dev            # → http://localhost:5173
```

Demo accounts (password `DataVista123`): `super@`, `admin@`, `analyst@`, `viewer@datavista.dev`.

## Six bugs found and fixed during verification

Each was caught by tests or by driving the running app, not by inspection:

1. **Narrow-CSV delimiter misfire** — pandas' sniffer split a single `region` column on the letter `o`. Replaced with deterministic delimiter detection.
2. **Silent missing-value coercion** — `n/a` became `NaN`, hiding real data-quality problems. Missing-value tokens are now explicit and inconsistencies reported.
3. **Swallowed validation errors** — the analytics client rewrote deliberate 4xx messages as `UPSTREAM_UNAVAILABLE`, storing wrong import error codes.
4. **Zero-height charts** — a `flex-1` wrapper gave Recharts a 0 px box, rendering blank canvases.
5. **Data directory outside the project** — working-directory-relative config wrote 28 MB of state to the wrong path; now path-anchored to the repo root.
6. **Navigation as buttons** — "Explore" and "New chart" were buttons, so they could not be opened in a new tab or reached as links. Now real links (found by the E2E suite, not a human).

Plus two correctness improvements: forecasting now requires a candidate to beat the naive baseline by >2% before displacing it, and monthly series are detected from median gaps rather than a fragile frequency guess.

## CI

`.github/workflows/ci.yml` runs on every push and PR: four jobs covering the API suite (with the Python analytics service started alongside it), `pytest`, the web unit tests plus a production build, and Docker image builds.

First real execution, [run 45129764261](https://github.com/Moha569-A/datavista/actions/runs/45129764261): **all four jobs green**. Image builds are now gated on whether image inputs actually changed (a `changes` job diffs paths since the previous commit) instead of rebuilding three images for a docs commit.

Two failures that only appeared in CI are recorded in `docs/TESTING.md` — a backgrounded service being reaped between steps, and a change-detection gate that matched commit messages rather than files. Both are fixed; the local suites never exercised either.

## Honest gaps (documented in `docs/SECURITY.md` and `docs/TESTING.md`)

- Password reset queues an audited request; outbound email is post-MVP, so an administrator must act on it.
- Storage is a local-directory abstraction; the S3 implementation is a drop-in but not included.
- `dataset_rows` in JSONB suits the 50,000-row MVP cap; larger volumes need Parquet/DuckDB (noted in the schema).
- No load testing of large-file imports or visual-regression snapshots yet.
- PostgreSQL row-level security is not enabled; the service layer enforces authorization and permission tests cover it.

## Key documents

- [`README.md`](README.md) — setup, commands, structure
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, pipelines, decisions
- [`docs/API.md`](docs/API.md) — every endpoint and error contract
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, controls, production checklist
- [`docs/TESTING.md`](docs/TESTING.md) — strategy, coverage, gaps
- [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) — requirement → code → test
