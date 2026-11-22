# API reference

Base path `/api`. All requests and responses are JSON. Authentication is an HttpOnly session cookie (`dv_session`), issued by login/register and required by every endpoint except the auth pair.

State-changing requests (`POST`, `PATCH`, `PUT`, `DELETE`) must also send `x-csrf-token` with the value of the readable `dv_csrf` cookie (double-submit). The bundled client does this automatically.

## Conventions

- Identifiers are UUIDs; timestamps are ISO-8601 UTC.
- Lists are paginated with `{ data, pagination: { page, pageSize, total } }`.
- Errors always use:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Please correct the highlighted fields.",
             "details": { "fields": { "email": "Enter a valid email address." } },
             "requestId": "b1f0…" } }
```

Common codes: `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `VALIDATION_ERROR` (422), `RATE_LIMITED` (429), `UPSTREAM_UNAVAILABLE` (502), `INTERNAL_ERROR` (500).

Resources the caller may not see return **404**, not 403 — identifiers cannot be probed for existence.

---

## Health

`GET /health` → `{ status, service, version, dependencies: { analytics: "up"|"down" }, time }`

## Authentication

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{name, email, password}` | First account becomes `super_admin`; later accounts are `analyst`. 201 with session cookie. |
| POST | `/auth/login` | `{email, password}` | Generic 401 on bad credentials; 403 when the account is suspended. |
| POST | `/auth/logout` | — | Clears cookies. |
| GET | `/auth/me` | — | `{ user, permissions }`; 401 when anonymous. |
| PATCH | `/auth/me` | `{name?, currentPassword?, newPassword?}` | Password change bumps `token_version` (all other sessions die) and returns `{reauthenticate: true}`. |
| POST | `/auth/forgot-password` | `{email}` | Always the same response; the request is audited for an administrator. |

`permissions` is `{ canManageUsers, canSuperAdmin, canUploadDatasets, canBuildCharts, canRunForecasts, canViewAdminMetrics }`.

## Datasets

| Method | Path | Notes |
|---|---|---|
| GET | `/datasets?page&pageSize&search&status` | Own + shared (admins see all). |
| POST | `/datasets/upload` | `multipart/form-data` field `file`. `.csv`/`.xlsx`, ≤ `MAX_UPLOAD_MB`. **202** with `{id, name, status:'pending'}` — processing is asynchronous. Analysts and above. |
| GET | `/datasets/:id` | Metadata, column profile, warnings, shares, latest job, `permission`, `canEdit`. Storage keys are never returned. |
| GET | `/datasets/:id/preview?page&pageSize` | Paginated rows (pageSize capped at 200). |
| PATCH | `/datasets/:id` | `{name}`. Owner or edit grant. |
| DELETE | `/datasets/:id` | Owner or admin. Removes file, rows and dependent charts. |
| POST | `/datasets/:id/retry` | 202; new job row. |
| POST | `/datasets/:id/shares` | `{email, permission: 'view'|'edit'}`. Owner only. |
| DELETE | `/datasets/:id/shares/:userId` | Owner only. |
| GET | `/datasets/:id/download-link` | `{url, expiresInSeconds}` — short-lived signed token. |
| GET | `/datasets/:id/download?token=` | Streams the original file after re-authorizing the token subject. |

Import status values: `pending`, `processing`, `ready`, `failed`. Failure codes include `NO_ROWS`, `EMPTY_FILE`, `PARSE_ERROR`, `UNSUPPORTED_FILE_TYPE`, `TOO_MANY_ROWS`, `TOO_MANY_COLUMNS`, `IMPORT_FAILED`.

## Charts

**POST `/charts/query`**

```json
{
  "datasetId": "uuid",
  "chartType": "bar",
  "xField": "region",
  "yField": "revenue",
  "aggregation": "sum",
  "filters": [{ "field": "category", "operator": "eq", "value": "Hardware" }],
  "limit": 12,
  "sort": "desc"
}
```

`chartType` ∈ `bar|pie|line|area|scatter|histogram`. `aggregation` ∈ `sum|avg|count|count_distinct|min|max|median|none`. Filter operators: `eq|neq|contains|gt|gte|lt|lte`. Maximum 10 filters, `limit` ≤ 200.

Response:

```json
{
  "data": [{ "label": "East", "value": 2531681 }],
  "meta": { "rowCount": 1218, "groupCount": 5, "filteredRowCount": 1218,
            "truncated": false, "limit": 100, "datasetId": "uuid", "computedAt": "…" }
}
```

Empty results return `data: []` with a `meta.note` explaining why. Incompatible requests return 422 with a message naming the offending field.

| Method | Path | Notes |
|---|---|---|
| GET | `/charts?datasetId=` | Saved charts for the current user. |
| POST | `/charts` | `{datasetId, title, chartType, configuration}` → 201. |
| POST | `/charts/validate` | Pre-flight compatibility check → `{compatible, problems}`. |
| PATCH | `/charts/:id` | `{title?, configuration?}`. Owner only. |
| DELETE | `/charts/:id` | Owner only; reports affected dashboards. |

## Dashboards

**GET `/dashboards`** → `{ owned: [...], shared: [...] }`, each item with `permission`, `canEdit`, `isShared`, `widgetCount`.

| Method | Path | Notes |
|---|---|---|
| POST | `/dashboards` | `{name, description?}` |
| GET | `/dashboards/:id` | Layout, widgets (with chart configuration and dataset name), shares, `canEdit`. |
| PATCH | `/dashboards/:id` | `{name?, description?, isDefault?, layout?}`. Owner or edit grant. |
| DELETE | `/dashboards/:id` | Owner (or admin oversight). |
| POST | `/dashboards/:id/duplicate` | Copies layout and widgets into a new dashboard owned by the caller. |
| PUT | `/dashboards/:id/widgets` | `{widgets: [{chartId, position:{x,y,w,h}}]}` — atomic replace. Validates every chart is visible to the dashboard owner. |
| POST | `/dashboards/:id/shares` | `{email, permission:'view'\|'edit'}`. Owner only. |
| DELETE | `/dashboards/:id/shares/:userId` | Owner only; access ends on the next request. |

## Analytics

| Method | Path | Notes |
|---|---|---|
| POST | `/analytics/forecast/check` | `{datasetId, targetColumn, timeField?}` → `{suitable, problems[], notes[], observations, targetType}` |
| POST | `/analytics/forecast` | 202 `{id, status:'processing'}`. Body: `{datasetId, targetColumn, timeField?, horizon (1–90), modelType: auto\|linear\|seasonal_naive\|baseline}` |
| GET | `/analytics/forecast` | Run history (50 most recent). |
| GET | `/analytics/forecast/:id` | Full run: `metrics`, `baselineMetrics`, `modelComparison`, `history`, `forecast`, `warnings`, `disclaimer`. |

Analysts and above only.

## Admin

Admin or super admin, except where noted.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/overview` | KPI totals, datasets-by-charts, 14-day import trend. |
| GET | `/admin/users?page&pageSize&search&role&status` | Includes dataset/dashboard counts. |
| POST | `/admin/users` | `{name, email, password, role}`. Granting admin roles requires super admin. |
| PATCH | `/admin/users/:id/role` | `{role}`. No self-edits; admins cannot modify admins; last super admin protected. |
| PATCH | `/admin/users/:id/status` | `{isActive}`. Bumps `token_version`, invalidating live sessions. |
| GET | `/admin/metrics` | Users, datasets, success rate, failure reasons, totals. |
| GET | `/admin/activity?page&pageSize` | Append-only audit trail with actor. |

## Notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | 40 most recent + `unreadCount`. |
| POST | `/notifications/read-all` | Marks all read. |
| POST | `/notifications/:id/read` | Marks one read. |

## Socket.IO

Path `/socket.io`, authenticated by the session cookie; the server assigns a single `user:<id>` room.

| Event | Payload |
|---|---|
| `dataset:processing` | `{datasetId, jobId, status}` |
| `dataset:ready` | `{datasetId, jobId, rowCount, updatedAt, message, link}` |
| `dataset:failed` | `{datasetId, jobId, errorCode, message, link}` |
| `dashboard:refresh` | `{dashboardId, reason, updatedAt}` |
| `forecast:ready` | `{runId, datasetId, message, link}` |
| `forecast:failed` | `{runId, datasetId, errorCode, message}` |

Client → server: `sync(ack)` returns in-flight datasets so a reconnect can reconcile missed events.
