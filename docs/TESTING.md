# Testing

145 automated tests across three suites. Run everything with `npm test`.

| Suite | Command | Count | Scope |
|---|---|---|---|
| API | `npm run test:api` | 70 | HTTP contract, validation, object-level authorization, privilege escalation |
| Web | `npm run test:web` | 22 | Formatters, chart rendering states, chart compatibility rules |
| Analytics | `npm run test:analytics` | 53 | Parsing/profiling, aggregation correctness, forecast suitability and metrics |

The API suite drives the real Express app through Supertest with a cookie jar, so CSRF and session semantics are exercised rather than mocked. Each file gets an isolated PGlite directory and storage folder.

> Analytics-dependent API assertions need the Python service on `:8788`. Without it the harness prints a notice and skips those cases instead of reporting false failures (`npm run dev` or `uvicorn` first).

## What is covered

**Authentication** — first-user super admin, duplicate email, weak password, malformed email, generic credential errors, non-disclosure of account existence, logout invalidation, CSRF rejection, identical password-reset responses.

**Authorization** — owner read, foreign-user 404 (not 403), hidden preview and chart data, prevented deletion, storage key never exposed, share grant → revoke with immediate effect, view-only recipients blocked from saving charts or editing widgets, edit grants allowed, viewer blocked from admin/upload/forecast endpoints, admin self-escalation refused, admin-on-admin refused, suspension invalidating live sessions, last-super-admin protection.

**Datasets** — accepted CSV/DELIMITER variants, XLSX round trip, unsupported extension, empty file, header-only file, malformed XLSX, missing file, quality warnings (duplicates/missing/type inconsistency), pagination and page-size clamping, rename/list/delete, signed download link, error contract for unknown routes and bad query params.

**Charts** — sums, averages, counts, distinct counts, min/max/median verified against hand-computed fixtures; equality, numeric comparison and literal `contains` filters; empty-after-filter behaviour; chronological ordering for time charts; histograms; pie shape; unknown column, unsupported type, text-sum incompatibility, missing x-axis, oversized limit, `validate` endpoint explanations; saved chart persistence and deletion.

**Forecasting** — suitability approval/rejection, non-numeric target, unparseable dates, insufficient history, invalid horizons, prediction intervals bracketing the forecast, baseline included in every comparison, exactly one selected model, clean trend beating the baseline, noisy series producing warnings, explicit baseline request, monthly cadence detection, missing values in the target, finite metrics, async run lifecycle, stored history, clean failure on unsuitable data.

**Frontend** — number/byte/date formatting and invalid input; chart loading/empty/error states with retry; bar and pie geometry counts; screen-reader summary; chart-type palette; "why this cannot be generated" messages for text-sum, missing x-axis and non-numeric histogram.

## Notable bugs caught by these tests

1. **Narrow-CSV delimiter misfire** — pandas' `Sniffer` split a single `region` column on the letter `o`. Replaced with deterministic delimiter counting; regression covered by the parsing suite.
2. **Silent missing-value coercion** — pandas converted `n/a` to `NaN`, so genuine data-quality problems looked like clean numeric columns. Missing-value tokens are now explicit and inconsistencies are reported.
3. **Swallowed validation errors** — the analytics client's catch block rewrote deliberate 4xx validation errors as `UPSTREAM_UNAVAILABLE`, so failed imports stored the wrong error code. Fixed and covered.
4. **Zero-height charts** — a `flex-1` wrapper gave Recharts a 0 px box. Fixed in `ChartView`, and the jsdom harness now supplies real element metrics so a regression would fail the render tests.

## Manual / exploratory checks performed

- Full analyst journey: login → upload → async ready → chart builder → save → add to dashboard → reload → forecast.
- Viewer journey: restricted nav, direct URL navigation redirected, shared dashboard read-only with no editor controls.
- Super admin: user table, role guards, audit trail and metrics.
- Responsive behaviour at 375 px, 768 px and 1440 px.
- Live updates: socket connected, import events received, dashboard refresh on dataset completion.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request:

| Job | What it runs |
| --- | --- |
| API — tests | `npm ci`, `pip install`, then the analytics service and `npx vitest run` **in the same step** |
| Analytics — pytest | `python -m pytest` in `services/analytics` |
| Web — build + unit tests | `npx vitest run` and `npm run build` |
| Detect image-relevant changes | Diffs paths since the previous commit, sets an `images` output |
| Docker images build | All three images, skipped unless image inputs changed |

End-to-end tests are **not** in CI: they need API, analytics and web running together plus a seeded database, which is a heavier job than the unit suites justify at this stage. Run them locally with `npm run test:e2e`.

## Two CI-only failures worth recording

Neither was reproducible locally, which is the point of running CI at all.

1. **Backgrounded service reaped between steps.** The API job started `uvicorn … &` in one step and probed `/health` in the next. The runner tears down a step's process tree when the step exits, so the server was gone by the probe: the job failed after burning a full 60 s timeout, with the actual suite never running. Starting, probing and testing inside one step keeps the service in the same process tree; an `EXIT` trap reaps it even when the suite fails, so a failing test never hangs the job.
2. **Change detection matched commit messages.** The Docker gate tested for the substring `Dockerfile` (and friends) inside `github.event.commits`, which serialises commit *messages* as well as file paths — so a doc commit whose message mentioned Dockerfile rebuilt three images. Replaced by a `changes` job that diffs real paths. Verified both ways locally: a workflow-only commit yields `images=false`, a `Dockerfile.api` change yields `images=true`.

## Gaps and next steps

- The browser journeys (`tests/e2e/analyst-journey.spec.js`, 3 tests) run locally against a live stack; they are not wired into CI.
- Load testing of large-file imports and high-cardinality chart queries is not automated.
- No visual-regression snapshots yet.
