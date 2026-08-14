# Issue #64 — HTTP layer hardening

## What was wrong

Five separate problems lived in twelve lines of `backend/app.js`.

| # | Problem | Consequence |
| --- | --- | --- |
| 1 | `cors()` with no options | Every origin was reflected, so any page on the internet could read authenticated API responses from a logged-in user's browser |
| 2 | `express.json()` with no explicit limit and no error mapping | A body of `{` produced a bare 500 |
| 3 | No security response headers | `/uploads` serves user-supplied files from the API origin, so a sniffed content type was a real XSS vector |
| 4 | No 404 handler | `GET /api/user/typo` returned an HTML page; every client here reads `res.data.success`, so it surfaced as a JSON parse failure |
| 5 | Error handler never logged `err` | A production 500 left no stack, no route and no message behind |

There was also no liveness endpoint that a container orchestrator could poll.

## What changed

`app.js` is now wiring only. Each concern moved into its own module so it can be
unit tested on its own.

### `config/cors.js`

Reads the comma separated `FRONTEND_URL` allowlist that `.env.example` has
carried all along. Trailing slashes are normalised, so `http://localhost:5173/`
and `http://localhost:5173` are the same origin.

Requests with **no** `Origin` header are allowed on purpose — curl,
server-to-server calls and health checks do not send one, and CORS is a browser
mechanism that has nothing to say about them. A disallowed origin gets
`callback(null, false)` rather than an `Error`, so the response is a clean CORS
rejection instead of a 500.

### `middlewares/securityHeaders.js`

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, a `Permissions-Policy` that turns off camera,
microphone and geolocation, and `X-DNS-Prefetch-Control: off`.

Four headers do not justify pulling helmet and its dependency tree into the
project, and writing them here keeps the policy visible.

`Strict-Transport-Security` is separate: it only goes out on HTTPS requests
(directly or via `X-Forwarded-Proto`) and only when enabled, because setting it
on a local `http://` origin pins the browser for a year. It defaults to on when
`NODE_ENV=production` and can be forced either way with `ENABLE_HSTS`.

### `middlewares/notFoundHandler.js`

Unmatched `/api/*` paths get `404 { success: false, message }`. Non-API paths —
the static `/uploads` mount — keep Express's default behaviour, so a missing
file still looks like a missing file.

### `middlewares/errorHandler.js`

Classifies before it answers:

| Error | Status |
| --- | --- |
| `MulterError` | 400 (unchanged) |
| `entity.parse.failed` | 400 `Malformed JSON body` |
| `entity.too.large` | 413 `Request body is too large` |
| Mongoose `CastError` | 400 `Invalid value for <path>` |
| Mongoose `ValidationError` | 400 with the field messages |
| Anything carrying a 4xx `status` | that status |
| Everything else | 500, generic message |

Only errors that are deliberately recognised get their message forwarded, so
driver errors, file paths and connection strings never reach a client. Client
mistakes are logged at `warn`, genuine faults at `error` with the stack — both
with method, path and status.

### `routers/healthRoutes.js`

`GET /api/health` returns `{ success, status, uptimeSeconds, database }`, 200
when Mongo is connected and 503 otherwise. It reads the driver's cached
`readyState` rather than issuing a ping, so a health check cannot add load
during an incident.

### `app.js` extras

- `x-powered-by` disabled.
- `TRUST_PROXY=true` turns on Express's `trust proxy`, which is what makes
  `req.ip` and `req.secure` meaningful behind a load balancer.
- `JSON_BODY_LIMIT` (default `1mb`) applies to both JSON and urlencoded bodies.

## New settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `JSON_BODY_LIMIT` | `1mb` | maximum accepted body size |
| `TRUST_PROXY` | `false` | read `X-Forwarded-*` when behind a proxy |
| `ENABLE_HSTS` | `NODE_ENV=production` | send `Strict-Transport-Security` |

`FRONTEND_URL` already existed and is now actually used.

## Testing

```bash
cd backend
node --test tests/http-hardening.test.js
```

The suite builds a miniature Express app around the middleware under test, so it
never loads the routers or the database models. Twenty-three tests cover the
allowlist, the no-Origin case, every header, both HSTS branches, the JSON 404,
the malformed-body and oversized-body paths, each error classification, and both
health states.

Manual check against a running server:

```bash
curl -i -H "Origin: https://evil.example" http://localhost:5000/api/user/getallcourses
curl -i http://localhost:5000/api/user/typo
curl -i -X POST http://localhost:5000/api/user/login -H 'Content-Type: application/json' -d '{'
curl -i http://localhost:5000/api/health
```
