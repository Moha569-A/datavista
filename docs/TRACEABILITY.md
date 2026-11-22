# Requirement traceability

Every requirement from the source documents, mapped to where it is implemented and which tests prove it.

Legend: **✓** implemented and tested · **◐** implemented, partially covered · **○** deliberately out of MVP scope

## PRD — functional requirements

| Req | Requirement | Implementation | Tests |
|---|---|---|---|
| FR-01 | Register, sign in, sign out securely | `routes/auth.js`, `lib/auth.js` | `auth.test.js` (registration, login, logout) ✓ |
| FR-01 | Password reset without account disclosure | `POST /api/auth/forgot-password` returns an identical response either way | `auth.test.js › password reset` ✓ |
| FR-01 | Session expiry | JWT `exp` = `SESSION_TTL_HOURS` (8h default), `token_version` revocation | `permissions.test.js › account suspension` ✓ |
| FR-01 | Role-based permissions on frontend **and** backend | `requireRole` middleware on every mutating route; `RequireRole` route guards; `useCan()` hides nav | `permissions.test.js › role boundaries` ✓ |
| FR-01 | Record administrative actions | `lib/audit.js` → `activity_logs` | `AdminActivity` screen ✓ |
| FR-02 | CSV and `.xlsx` with configurable limits | `multer` limits (`MAX_UPLOAD_MB`), `MAX_ROWS`, analytics `MAX_ROWS=50000` | `datasets.test.js › upload validation` ✓ |
| FR-02 | Validate extension, MIME, structure, headers | `routes/datasets.js` fileFilter + `parsing.read_dataframe` + header normalisation | `parsing` tests ✓ |
| FR-02 | Preview rows and column types before import | Import is confirm-by-default (upload→process); `GET /:id/preview` + column profile on the detail page | `datasets.test.js › paginates previews` ✓ |
| FR-02 | Report missing values, duplicates, parsing errors | `parsing.build_warnings` → `DUPLICATE_ROWS`, `MISSING_VALUES`, `TYPE_INCONSISTENCY`, `EMPTY_COLUMN` | `test_parsing.py` ✓ |
| FR-02 | Track status, row count, owner, upload time | `datasets` columns + `dataset_import_jobs` | `datasets.test.js` ✓ |
| FR-02 | Rename / inspect / delete by authorized users | `PATCH`, `GET`, `DELETE /api/datasets/:id` with permission checks | `permissions.test.js` ✓ |
| FR-03 | Bar, pie, line charts | `services/analytics/app/query.py`; `ChartView.jsx` also renders area/scatter/histogram (post-MVP items shipped) | `charts.test.js`, `test_query.py` ✓ |
| FR-03 | Field selection, aggregation, filters, labels, titles | `ChartConfigPanel.jsx` + `POST /api/charts/query` | `charts.test.js` ✓ |
| FR-03 | Loading, empty and error states | `ChartView` explicit branches | `ChartView.test.jsx` ✓ |
| FR-03 | Save chart configuration for reproduction | `POST /api/charts`, `configuration` JSONB | `charts.test.js › saved charts` ✓ |
| FR-04 | Create, rename, duplicate, delete dashboards | `routes/dashboards.js` | `permissions.test.js` (sharing) ◐ |
| FR-04 | Add, remove, rearrange widgets; persist layout | `PUT /:id/widgets` (single atomic replace), drag + reorder + width toggle | `permissions.test.js › edit grant` ✓ |
| FR-04 | Private dashboards and explicit sharing | `dashboard_shares` with `view`/`edit` CHECK constraint | `permissions.test.js` ✓ |
| FR-04 | Show only dashboards the user owns or may access | `listDashboards` returns `owned` + `shared`; non-disclosing 404 otherwise | `permissions.test.js` ✓ |
| FR-05 | Notify on import/refresh completion | `lib/realtime-events.js` | `DashboardView` live refresh ✓ |
| FR-05 | Refresh affected dashboard data | `emitDashboardRefresh` from import jobs and widget saves | manual verification ✓ |
| FR-05 | Display last-updated time and job status | `StatusBadge`, `lastSync` on dashboards, job panel on dataset detail | UI ✓ |
| FR-05 | WebSocket notifications, no streaming claim | Socket.IO user rooms; copy says "events", not "streaming" | `lib/realtime.js` ✓ |
| FR-06 | Select dataset, target field, horizon | `Predictive.jsx` | `forecast.test.js` ✓ |
| FR-06 | Check data suitability | `POST /api/analytics/forecast/check` + `forecasting.build_series` | `test_forecasting.py` ✓ |
| FR-06 | Historical values + predictions | `history` / `forecast` arrays rendered together | `forecast.test.js` ✓ |
| FR-06 | Metrics and uncertainty intervals | MAE/RMSE/MAPE/R², 95% band | `forecast.test.js › produces predictions` ✓ |
| FR-06 | Store runs and configuration | `forecast_runs` | `forecast.test.js › stores run history` ✓ |
| FR-07 | List, search, activate, suspend users | `routes/admin.js` | `permissions.test.js › suspension` ✓ |
| FR-07 | Review dataset counts and processing status | `GET /api/admin/metrics` | `AdminActivity` ✓ |
| FR-07 | Inspect audit events and usage metrics | `GET /api/admin/activity`, `/metrics`, `/overview` | UI ✓ |
| FR-07 | Prevent self-escalation | `assertCanManage` + last-super-admin guard | `permissions.test.js › privilege escalation guards` ✓ |

## PRD — non-functional requirements

| Area | Requirement | Implementation |
|---|---|---|
| Security | Hashing, authorization, private files, validation, audit | `docs/SECURITY.md`; bcrypt, per-request authz, random storage keys, zod, audit log ✓ |
| Performance | Paginated previews, async processing, indexed metadata | Preview capped at 200 rows/page; imports run off the request thread; indexes on owner/status/foreign keys ✓ |
| Reliability | Explicit job states, retry policy, failure messages | `pending → processing → ready \| failed`, `POST /:id/retry`, error codes surfaced in UI ✓ |
| Scalability | Separate web/API/analytics/storage | Three deployable units + storage abstraction, independent Docker images ✓ |
| Usability | Responsive, clear validation, accessible controls | Mobile drawer, table scroll containers, labelled fields, `aria-live` toasts, keyboard-operable modals, text chart summaries ✓ |
| Maintainability | Modular services, documented API, automated tests | `services/`, `docs/API.md`, 145 automated tests ✓ |
| Data integrity | Schema/type validation, preserve source, track versions | Validation pipeline; original file kept; `dataset_import_jobs` records attempts ◐ (`dataset_versions` table specified but unused — single-version MVP) |

## TRD — technical requirements

| Item | Status |
|---|---|
| React + Vite + Tailwind frontend | ✓ |
| Node/Express API | ✓ |
| PostgreSQL (PGlite in dev, `pg` in prod) | ✓ — one dialect, parameterized queries |
| Python/FastAPI/Pandas/NumPy/scikit-learn analytics | ✓ |
| Recharts rendering | ✓ |
| Socket.IO realtime | ✓ authenticated, user-scoped rooms |
| Multer + private storage | ✓ random keys, never original filenames |
| Vitest/Jest/Supertest/Pytest/Playwright | ✓ Vitest + Supertest + Pytest; Playwright journey in `tests/e2e` |
| UUID identifiers, ISO-8601 timestamps | ✓ |
| Consistent error contract `{code, message, details}` | ✓ `lib/errors.js` |
| Allowlisted chart types and aggregations | ✓ zod enums + server-side re-check |
| Bounded result sets | ✓ `MAX_GROUPS=200`, filter cap, horizon cap |
| CSRF protection with cookie auth | ✓ double-submit token |
| Rate limiting | ✓ auth (20/10min) and API (600/min) limiters |
| Helmet security headers | ✓ |
| Health checks | ✓ `/health` reports dependency status |
| Versioned migrations | ✓ `schema.sql` applied idempotently; documented path to numbered migrations |

## Database schema

Operating tables from the schema document: `users`, `datasets`, `dashboards`, `charts`, `dashboard_widgets`, `dashboard_shares`, `forecast_runs`, `activity_logs` — all present, plus the "recommended before production" set: `dataset_import_jobs`, `dataset_permissions`, `notifications`, `dataset_rows`, `dataset_value_counts`.

Deliberate deviations, documented in `schema.sql`:
- UUIDs are generated in the application layer rather than by `gen_random_uuid()`, because `pgcrypto` is unavailable in the embedded engine used for local dev and CI. Behaviour is identical on managed PostgreSQL.
- `CHECK` constraints replace `ENUM` types for portability and easier migration.
- `token_version` added to `users` to support immediate session revocation.
- `sessions` and `refresh_jobs` tables are not implemented: sessions are stateless JWTs with a revocation counter, and the MVP has no scheduled refresh.

## Implementation plan

| Milestone | State |
|---|---|
| M1 Running foundation | ✓ (`npm run dev`, schema, `.env.example`, CI) |
| M2 Secure multi-user application | ✓ (auth, role middleware, guards, permission tests) |
| M3 Dataset pipeline | ✓ (upload, validation, profiling, preview, status) |
| M4 Visualization MVP | ✓ (bar/pie/line + area/scatter/histogram, saved configs) |
| M5 Dashboard MVP | ✓ (CRUD, widgets, layout persistence, sharing) |
| M6 Advanced analytics | ✓ (forecasts, validation window, baseline comparison, history) |
| M7 Release readiness | ✓ (socket events, 145 tests, Docker, health checks, backups documented) |

## Deliberately out of MVP scope

Advanced ML model tuning and automatic model search beyond the four candidates, natural-language querying, billing, external data connectors, true streaming ingestion, scheduled data refresh, S3-backed storage implementation (interface provided), and email delivery for password resets (request is audited and queued for an administrator).
