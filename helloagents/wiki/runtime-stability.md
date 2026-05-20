# Runtime Stability Hardening (2026-03-20)

## Scope
- Frontend: React + Vite runtime guards.
- Backend: NestJS telemetry intake endpoint.
- Deployment: Docker build consistency and nginx cache policy alignment.

## Frontend changes
- Added startup runtime bootstrap in `frontend/src/bootstrap/runtimeStability.ts`.
- Added storage schema guard keyed by `VITE_STORAGE_SCHEMA_VERSION` to clear stale persisted client state during breaking releases.
- Added production version polling against `/version.json`, with reload flow on mismatch.
- Added global error capture for:
  - `window.onerror`
  - `unhandledrejection`
  - static resource load errors
- Added structured frontend error reporting to backend endpoint `/api/telemetry/frontend-error`.
- Autosave keeps 5s debounce, plus a 15s minimum persisted save interval to avoid write amplification under burst edits.

## Backend changes
- Added `TelemetryModule` with controller endpoint:
  - `POST /api/telemetry/frontend-error`
- Logged structured runtime failure payloads with app/build context for release triage.
- OpenObserve `backend_request` now enforces a whole-body log limit: if serialized `body` exceeds `4096` chars, telemetry stores a summarized object with `preview` and `originalLength` instead of the raw payload; override with `OPENOBSERVE_BACKEND_REQUEST_BODY_MAX_LENGTH`.
- Added OpenObserve `backend_error` reporting for backend exceptions:
  - global Nest HTTP exception filter now reports message, stack, status code, route, request context, and trace/request/user identifiers
  - when a backend exception happens after an upstream `fetch`, `backend_error` also includes `upstream_url`, `upstream_host`, `upstream_status_code`, `upstream_payload`, `upstream_response`, and `upstream` using the latest sanitized upstream request captured in the current request context
  - process-level `unhandledRejection` / `uncaughtException` are ingested into the same stream for crash triage
- Added per-project serialized save execution and duplicate-content hash short-circuit in ProjectsService.updateContent to reduce concurrent save amplification without dropping real changes.

## Deployment changes
- Frontend Docker builder now installs full dependencies (`npm ci`) and accepts build args:
  - `APP_VERSION`
  - `STORAGE_SCHEMA_VERSION`
- nginx cache policy updated:
  - `index.html` => no-store/no-cache
  - `version.json` => no-store/no-cache
  - hashed static assets => long cache + immutable

## Verification status
- Backend build: passed (`npm run build` in `backend/`).
- Frontend type check/build entry: reached Vite gate, blocked by local Node version (`20.18.1`) requiring `20.19+`.

## Weak-network image delivery hardening (2026-04-12)

### Frontend changes
- Added image-fetch policy in `frontend/src/utils/imageSource.ts`:
  - adaptive timeout/retry by runtime network quality (`navigator.connection`)
  - retryable status handling (`408/425/429/500/502/503/504`)
  - unified timeout-linked abort signals to prevent stuck image requests
- Updated image source resolution (`resolveImageToDataUrl` / `resolveImageToBlob`) to use resilient fetch path instead of direct one-shot fetch.
- Added `tai.tarvas.cn` to managed/allowed host assumptions for public asset resolution and proxy compatibility.
- `SmartImage` and `SmoothSmartImage` now default to `loading="lazy"` and `decoding="async"` when caller does not override.

### Backend changes
- Hardened `GET /api/assets/proxy` in `backend/src/oss/assets.controller.ts`:
  - upstream timeout guard (env: `ASSET_PROXY_UPSTREAM_TIMEOUT_MS` / `OSS_PROXY_TIMEOUT_MS`, default `12000ms`)
  - one-round retry on retryable upstream statuses
  - timeout and client-abort linking to stop upstream pull quickly when downstream is closed

### Ops notes
- CDN custom domain `OSS_CDN_HOST=tai.tarvas.cn` is now directly compatible with the frontend managed-host and proxy allowlist.
- If WAN conditions are unstable in event venues, prefer direct CDN URL fetch first and fallback to `/api/assets/proxy` only for CORS/host mismatches.

## Leave-risk guard hardening (2026-04-12)

### Frontend changes
- Upgraded leave-risk detection from only-uploading to `uploading + running`:
  - pending upload tasks / pending local images
  - running flow node status
  - global flow run state
- Added a global top warning banner in app workspace while risky tasks exist.
- SPA back/forward guard and browser `beforeunload` now use the unified risk summary, showing stronger warning copy for potential data loss.

### UX intent
- Prevent accidental page leave while generation/upload is in progress.
- Make loss risk explicit before user confirms force-leave.

## Asset persistence guard hardening (2026-05-20)

### Backend changes
- `OssService.signUrl` is now truly async and returns real signed read URLs (instead of effectively falling back to public URLs), improving private-bucket compatibility in asset proxy reads.
- Added `OssService.objectExists(key)` based on `HeadObject` for server-side object existence verification.
- `GET /api/assets/proxy` now resolves managed keys through async signed URLs and logs non-OK upstream responses with key/target/status for production triage.
- `ProjectsService.updateContent` now performs save-time validation for newly introduced managed asset keys in `Project.contentJson`:
  - compares previous persisted content vs current content
  - verifies only newly added managed keys
  - blocks save with `400` when referenced new assets are missing in OSS

### Effect
- Prevents "DB references a key but OSS object is missing" from being persisted again.
- Reduces post-save 404 incidents such as `/api/assets/proxy?key=projects/...`.




- Added Object.hasOwn polyfill at app bootstrap to prevent legacy Edge runtime crash in bundled dependencies.

## Backend DB Pressure Hardening (2026-03-21)

- Added anti-overlap guards for credits scheduler jobs to avoid concurrent runs fighting for Prisma pool connections.
- Split cron responsibilities:
  - pending timeout auto-refund keeps `EVERY_5_MINUTES`.
  - daily credit anomaly detection moved to `EVERY_HOUR`.
- Added explicit Prisma pool-timeout detection in AI `withCredits` path and map it to `503 ServiceUnavailable` (`数据库繁忙，请稍后重试`) instead of generic 500.
- Tuned stale-pending auto-refund default batch size from `200` to `100` to lower per-run DB burst pressure.
- Added Prisma index for stale pending scan:
  - `ApiUsageRecord @@index([responseStatus, serviceType, createdAt])`
