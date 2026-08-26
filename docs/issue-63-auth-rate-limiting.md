# Issue #63 — Brute-force protection for credential endpoints

## What was wrong

`backend/routers/userRoutes.js` wired every credential endpoint straight to its
controller:

```js
router.post("/login", loginController);
router.post("/verify-otp", verifyOtpController);
router.post("/forgot-password", forgotPasswordController);
router.post("/reset-password", resetPasswordController);
```

The codes those endpoints check are six numeric digits
(`Math.floor(100000 + Math.random() * 900000)`) valid for ten minutes. With no
cap on attempts, walking the 900,000 value keyspace is minutes of work, and the
`"Invalid or expired OTP"` response is a clean oracle for each guess. The same
gap made `/login` free for password spraying and `/forgot-password` free as a
mail bomb, since every call sends a real email and rewrites `resetToken`.

## The two layers

A single IP-based limiter is not enough on its own — an attacker with a pool of
addresses walks straight past it — so the fix adds two layers that cover
different attacks.

### 1. `middlewares/rateLimiter.js` — per client

A sliding-window counter kept in process memory. It caps how fast one client can
hit one endpoint family, sets `X-RateLimit-Limit` / `X-RateLimit-Remaining` on
every response and `Retry-After` on a 429. Keys are scoped per endpoint, so
burning the `/login` budget leaves `/verify-otp` untouched.

In-memory is the right trade-off while the backend runs as a single process: no
extra dependency, no database round trip on the hot path. If the deployment ever
grows to several instances, the store is a small injectable interface
(`record`, `retryAfterMs`, `clear`) that a Redis-backed implementation can
satisfy without touching the middleware.

### 2. `middlewares/verificationThrottle.js` — per account

This is the layer that actually stops the attack in the issue. It counts
**failed** attempts against the identifier being targeted (the email address)
and locks that identifier once the budget runs out, wherever the requests come
from. Counters live in `schemas/verificationAttemptModel.js` so they survive a
restart, keyed on `{ scope, identifier }` with a 24 hour TTL index for cleanup.

Two details worth calling out:

- **Success is read from the response body, not the status code.** The existing
  controllers answer a wrong OTP with `200 { success: false }`. The middleware
  wraps `res.send` to inspect the payload, which means the controllers did not
  have to change at all.
- **A counter failure never breaks the endpoint.** If the lookup or the write
  fails, the error is logged and the request proceeds; the IP limiter is still
  in front of it. Losing the throttle is bad, taking login offline is worse.

`/forgot-password` gets the rate limiter but no failure throttle: it answers
identically for known and unknown addresses on purpose, so there is no failure
to count.

## Configuration

All five settings are read from the environment with safe defaults, documented
in `backend/.env.example`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUTH_RATE_LIMIT_WINDOW_MINUTES` | 15 | length of the per-client window |
| `AUTH_RATE_LIMIT_MAX_REQUESTS` | 20 | requests per client per window per endpoint |
| `AUTH_MAX_FAILED_ATTEMPTS` | 5 | failures before an account is locked |
| `AUTH_FAILED_ATTEMPT_WINDOW_MINUTES` | 15 | how long failures are remembered |
| `AUTH_LOCKOUT_MINUTES` | 15 | how long a locked account stays locked |

With the defaults, the brute force in the issue gets five guesses per fifteen
minutes instead of unlimited — roughly 4.7 years of expected work against a
ten minute code.

## Files

- `backend/middlewares/rateLimiter.js` — sliding-window limiter
- `backend/middlewares/verificationThrottle.js` — per-account failure lockout
- `backend/schemas/verificationAttemptModel.js` — persisted counters
- `backend/routers/userRoutes.js` — both layers applied to the five endpoints
- `backend/.env.example` — new settings
- `backend/tests/rate-limiter.test.js`, `backend/tests/verification-throttle.test.js`

## Testing

```bash
cd backend
node --test tests/rate-limiter.test.js tests/verification-throttle.test.js
```

Both suites inject a fake clock and a fake model, so they run without a database
and without waiting on real time. They cover the window rollover, the lock and
its expiry, per-scope and per-client isolation, the double-`send` guard, and the
"counter store is down" path.
