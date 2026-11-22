# Architecture

## Components

| Unit | Tech | Responsibility | Deployable |
|---|---|---|---|
| Web SPA | React 18, Vite, Tailwind, Recharts, Socket.IO client | Rendering, chart configuration, dashboard editing | Static host / nginx |
| API | Node 20, Express 4, Socket.IO | Authentication, authorization, business rules, REST contract, realtime fan-out | Container |
| Analytics | Python 3.12, FastAPI, Pandas, NumPy, scikit-learn | Parsing, profiling, aggregation, forecasting | Container (internal only) |
| Database | PostgreSQL 16 (PGlite in dev) | Users, metadata, charts, dashboards, jobs, audit | Managed service |
| Storage | Local private directory (S3-compatible interface) | Original source files | Volume / bucket |

Trust boundaries:

```
browser ──cookie──► API ──service token──► analytics
                     │
                     ├── parameterized SQL ──► database
                     └── storageKey ─────────► private files
```

The browser has no route to the database, the file store or the analytics service. The analytics service refuses any request without the shared service token, and is expected to run on a private network.

## Request pipeline (API)

1. `helmet` security headers, CORS limited to `CLIENT_ORIGIN`.
2. Request correlation id (`x-request-id`) attached for logs and support.
3. JSON body limits (2 MB) — uploads use a separate multipart path.
4. Per-IP rate limit (600/min; 20 per 10 min on auth).
5. `loadUserFromCookie` resolves the session **against the database** on every request, so a suspended account or changed role takes effect immediately rather than at token expiry.
6. CSRF double-submit check on all state-changing methods.
7. Route middleware: `requireAuth` → `requireRole` → zod validation → service.
8. Services perform object-level authorization (owner / share / admin oversight) and re-check every referenced column against stored dataset metadata.
9. Central error handler converts everything into `{ error: { code, message, details?, requestId } }`, never leaking stack traces or SQL.

## Import pipeline

```
POST /api/datasets/upload
   ├─ multer (memory) → extension + MIME check → size check
   ├─ storage.put(randomKey)             # original filename stored as metadata only
   ├─ INSERT datasets (status=pending) + dataset_import_jobs
   └─ 202 Accepted  ──────────────────────► setImmediate(processImport)

processImport (background)
   ├─ status=processing → emit dataset:processing
   ├─ analytics /profile (service token)
   │     read_dataframe → header normalisation → row/column caps
   │     → type inference → profiling → quality warnings
   ├─ transaction: replace dataset_rows, value counts, metadata, job → ready
   ├─ emit dataset:ready  (+ persisted notification)
   └─ emit dashboard:refresh for every dashboard using this dataset
```

Failures set `status=failed` with an error **code** (`NO_ROWS`, `PARSE_ERROR`, `TOO_MANY_ROWS`, `UNSUPPORTED_FILE_TYPE`, …) plus a human message, and emit `dataset:failed`. Retries insert a new job row and reprocess — rows are replaced, never appended, so a retry cannot duplicate an import.

## Chart pipeline

```
POST /api/charts/query {datasetId, chartType, xField, yField, aggregation, filters, limit}
  ├─ resolveDatasetAccess(user, datasetId)         # 404 when not visible
  ├─ verify status === 'ready'
  ├─ verify x/y/filter columns exist in datasets.columns
  └─ analytics /query
        filters → validate operator allowlist → group by → aggregate
        → cap groups at 200 → chronological ordering for line/area
```

No SQL is constructed from user input: aggregation happens in pandas on an in-memory frame built from rows the API already authorized. Field names are validated twice (API against stored schema, analytics against the payload's column list).

## Dashboard model

`dashboards.layout` stores `{columns: 12, widgets: [{chartId, x, y, w, h}]}` while `dashboard_widgets` holds the authoritative rows. `PUT /api/dashboards/:id/widgets` replaces the set inside a transaction and recomputes the layout blob, so a failed save never leaves a half-applied layout. The client keeps a local copy of the arrangement and only persists on explicit "Save layout", which is what makes the unsaved-changes banner truthful.

## Realtime model

- Handshake authenticated by the same HttpOnly session cookie; user state is re-read from the database.
- Each socket joins exactly one server-assigned room, `user:<id>`. Clients cannot request rooms, so cross-tenant subscription is impossible.
- Events: `dataset:processing`, `dataset:ready`, `dataset:failed`, `dashboard:refresh`, `forecast:ready`, `forecast:failed`.
- Events are hints. On reconnect the client calls `sync` and re-reads authoritative state from REST. Notifications are also persisted so a missed socket event is not a missed message.

## Forecasting model

1. Suitability: numeric target (≥80% parseable), parseable time field, ≥12 observations, bounded horizon.
2. Daily bucketing by mean when a time field is present; otherwise stored row order.
3. Chronological split — the most recent `max(3, min(n/5, 12))` periods are held out. Time series are never shuffled.
4. Candidates: naive baseline (always), linear trend, seasonal naive (weekly, when ≥14 points), gradient boosting on lag features (when ≥30 points).
5. Selection: a candidate must beat the baseline RMSE by more than 2% to be chosen; otherwise the baseline is shown with an explicit warning. This prevents presenting a flexible model that is fitting noise.
6. Refit on full history, project the horizon, and build a 95% interval from the validation residual standard deviation that widens with the step index.
7. Persist configuration, chosen model, comparison table, metrics, results and warnings.

## Key decisions

**PGlite as the dev database.** Embedded PostgreSQL keeps the development story to a single command while running the *same* schema, constraints and parameterized SQL as production. `db/index.js` selects the driver; nothing in the service layer knows which is active. The one concession is app-generated UUIDs (documented in `schema.sql`).

**All-or-nothing widget saves.** Replacing the widget set in one transaction makes "save layout" idempotent and avoids partial writes that the UI would have to reconcile.

**Non-disclosing 404s.** Resources the caller may not see return 404, not 403, so dataset and dashboard IDs cannot be probed for existence. Genuine permission failures on visible resources (e.g. a view-only share attempting an edit) return 403 with guidance.

**Analytics errors are user-facing.** A 4xx from the analytics service is a validation outcome ("this column is text, so sum is not available"), so the API surfaces the code and message verbatim and the import job stores it. Only transport and 5xx failures are masked as `UPSTREAM_UNAVAILABLE`.

**Time-series honesty over model complexity.** The baseline-first selection rule and the always-visible disclaimer matter more than squeezing out a better RMSE on a short series.
