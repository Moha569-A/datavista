# Security model

## Threat model

| Threat | Control | Where |
|---|---|---|
| Credential theft from the database | bcrypt (cost 11) hashes; credentials never logged | `lib/auth.js` |
| Session hijacking / fixation | HttpOnly + SameSite=Lax cookies, `Secure` in production, 8h expiry, JWT issuer check, `token_version` revocation | `lib/auth.js`, `routes/auth.js` |
| CSRF | Double-submit token: readable `dv_csrf` cookie echoed in `x-csrf-token` on every mutation | `lib/auth.js › csrfProtection` |
| Privilege escalation | No self role/status edits; admins cannot modify admins; only super admins grant admin roles; last active super admin protected | `routes/admin.js › assertCanManage` |
| Cross-tenant data access | Object-level authorization on every dataset/chart/dashboard read and write; non-disclosing 404s | `services/*.js › resolve*Access` |
| Probing for resource existence | 404 for both "missing" and "not yours" | services |
| SQL injection | Parameterized queries only; aggregation never builds SQL from user input | `db/index.js`, `query.py` |
| Malicious file upload | Extension + MIME allowlist, size cap, random storage keys, source file never executed, XLSX opened `values_only`, traversal guard | `routes/datasets.js`, `lib/storage.js` |
| Stored XSS via dataset content | React escapes all values; no `dangerouslySetInnerHTML`; downloads served with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` | `ChartView`, `Explorer`, datasets route |
| Unauthenticated analytics access | Service-token header comparison (`hmac.compare_digest`), service intended to run privately | `services/analytics/app/main.py` |
| Socket eavesdropping / cross-tenant rooms | Handshake re-validated against the database; server-assigned one room per user; no client room joins | `lib/realtime.js` |
| Brute force | Auth limiter **20 requests / 10 min in production** (relaxed to 500 in development/test so iterative work and E2E runs are not locked out); generic error messages | `routes/auth.js`, `app.js`, `config.js` |
| Denial of service via large payloads | 2 MB JSON limit, `MAX_UPLOAD_MB`, row/column caps, bounded group cardinality, bounded forecast horizon, per-request timeouts | `config.js`, `query.py`, `forecasting.py` |
| Resource enumeration via timing | Password comparison runs even for unknown emails | `routes/auth.js › login` |
| Audit tampering | `activity_logs` is append-only through the API; no update/delete route exists | `lib/audit.js` |

## Session lifecycle

1. Login verifies the hash and issues a JWT (`sub`, `role`, `tv`) in an HttpOnly cookie plus a CSRF cookie.
2. Every request re-reads `role`, `is_active` and `token_version` from the database. A suspended account or changed role is effective on the **next request**, not at token expiry.
3. Suspension and role changes bump `token_version`, invalidating live sockets and sessions.
4. Password change bumps `token_version` and clears cookies, forcing re-authentication.

## Data handling

- Uploaded files are stored under `storage/datasets/<32 random hex>.<ext>` with mode `0600`. The client-supplied filename is metadata only and is sanitised before being echoed in `Content-Disposition`.
- Download links are dataset-scoped JWTs valid for 5 minutes, and the endpoint re-authorizes the *calling* user, so a leaked link is useless to another account.
- Parquet/DuckDB is unnecessary at MVP volume; rows live in `dataset_rows.data` (JSONB) with a chunked insert.
- Deleting a dataset removes the row set, value counts, imports, shares, charts and the source file.

## Input validation

Two layers everywhere:

1. **Transport** — zod schemas (`lib/validate.js`) produce `details.fields` for inline form errors.
2. **Domain** — services re-check ownership, status and column membership against stored metadata; the analytics service independently validates every field against the payload's column list.

Chart field names are allowlisted by construction: they must exist in `datasets.columns`, and aggregations/operators/types are enum-checked on both sides.

## Production checklist

- [ ] `JWT_SECRET` and `ANALYTICS_SERVICE_TOKEN` set to 32+ random characters (`openssl rand -hex 32`)
- [ ] `AUTO_SEED=false`; no demo accounts in a real environment
- [ ] `DB_DRIVER=pg` with a managed PostgreSQL instance; TLS required
- [ ] `NODE_ENV=production` so cookies are `Secure`
- [ ] TLS terminated at the proxy; HSTS enabled
- [ ] API and analytics service on a private network; only the proxy is public
- [ ] `lib/storage.js` swapped for S3-compatible storage with encryption at rest
- [ ] Secrets in a managed secret store, never in the image or Git
- [ ] Logs shipped and scrubbed of credentials; error monitoring wired
- [ ] Backups configured and a restore rehearsed
- [ ] Data retention and deletion policy agreed and implemented (source files, derived rows, backups)
- [ ] Rate limits tuned for expected traffic; alerting on 401/403 spikes
- [ ] `AUTH_RATE_LIMIT` left unset (or set explicitly) so the production default of 20 applies
- [ ] Dependency audit (`npm audit`, `pip-audit`) in CI

## Known limitations (documented, not hidden)

- Password reset queues an audited request; outbound email is post-MVP, so an administrator must act on it.
- Storage is a local directory abstraction; the S3 implementation is a drop-in but not included.
- `dataset_rows` in JSONB suits the MVP cap of 50,000 rows; larger volumes need Parquet/DuckDB (documented in the schema notes).
- Row-level security is not enabled in PostgreSQL; the service layer is the enforcement point, and permission tests cover it.
