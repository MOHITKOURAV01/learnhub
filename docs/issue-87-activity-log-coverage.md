# Issue 87 — an activity log that only logs one thing

The admin Activity Logs page offers a Logout filter, a Role filter, and IP
address and device columns. Three of those could never show anything, because
one event was written and it was written without any request context.

The only two write sites:

```js
// userControllers.js
await ActivityLog.create({ userId: user._id, action: 'login', role: user.type, email: user.email });

// adminController.js
await ActivityLog.create({ action: "login", role: "Admin", email: credentials.username });
```

No `ipAddress`, no `userAgent`, and no second action anywhere:

```
$ grep -rn "logout" backend --include="*.js" | grep -v /tests/
backend/controllers/activityLogController.js:3:const ALLOWED_ACTIONS = new Set(["login", "logout"]);
backend/schemas/activityLogModel.js:13:      enum: ["login", "logout"],
```

Signing out was client-only — `clearSession()` and a redirect. The server was
never told.

## What was wrong

- **The Logout filter always returned nothing.** `?activity=logout` was
  accepted, matched zero documents, and rendered the empty state. There was no
  way to tell an account that signed out from one whose session was still open.
- **IP address and device were always null.** Both were selected, exposed and
  included in the free-text search — so searching for an IP was offered and
  could never match.
- **A failed login was not recorded at all**, so the log could not answer the
  one question an audit log exists for. #63 will throttle those attempts;
  nothing would have recorded them.
- **`role: "Admin"`** was written capitalised while `userModel` lowercases every
  other role, so the collection held both spellings.
- **`createdAt` was always undefined.** `sanitizedLogs` falls back to it when
  `timestamp` is missing, and the schema set `versionKey: false` but never
  `timestamps`.
- Both writes were `await`ed bare inside the controller's `try`, so a write
  failure surfaced to the user as a failed sign-in.

## What changed

### `utils/requestContext.js` (new)

`getClientIp(req)` reads `req.ip`, not `X-Forwarded-For`. Express resolves
`req.ip` from the forwarded headers only when `trust proxy` is set, which
`app.js` does behind `TRUST_PROXY=true`; reading the header directly would take
a client-supplied value at face value on a deployment that is not behind a
proxy. The IPv4-mapped IPv6 prefix is stripped, so `::ffff:203.0.113.4` and
`203.0.113.4` are stored the same way and a search for one finds the other.

`getUserAgent(req)` truncates at 300 characters. It is a client-supplied,
unbounded header.

### `utils/activityLog.js` (new)

`recordActivity()` — one writer, three rules the inline calls did not follow:

1. **Never fail the request.** Its own failures are caught and warned about. A
   login that succeeded must not become a 500 because an audit row could not be
   written.
2. **Always carry the request context.**
3. **Normalise.** Role and email are lowercased, so the admin login stops being
   the one row spelled differently.

### The events

- `login` — now with IP and device.
- `login_failed` — for a wrong password, for an address with no account, and for
  a failed admin login. The attempted address is recorded; the attempted
  password is not, and there is a test asserting it never appears in the
  collection.
- `logout` — `POST /api/user/logout`, behind `authMiddleware`. An open endpoint
  would let anyone write log rows for any account. There is no server-side
  session to destroy — the token is stateless — so it exists purely so signing
  out is recorded. `NavBar` calls it before clearing the session, best effort:
  a failure is swallowed and the user is signed out locally either way.

### Supporting changes

- `activityLogModel` gains `login_failed` in its enum and `timestamps: true`,
  which is what makes the controller's `createdAt` fallback work.
- `ALLOWED_ACTIONS` in the controller accepts `login_failed`, or the new filter
  would 400.
- The admin table gains a Failed login filter, a readable label — `login_failed`
  in a badge reads as a database column rather than an event — and a warning
  colour in both themes.
- `.env.example` notes that leaving `TRUST_PROXY=false` behind a proxy records
  the proxy's address on every row.

## Tests

`backend/tests/activity-log.test.js`, 18 tests. The unit half covers the IP and
User-Agent rules, including that a forwarded header is *not* read directly and
that a failing write is swallowed. The integration half drives the real routes:
a login recording IP and device, a logout being recorded at all, logout
rejecting an anonymous caller, both failed-login shapes, the admin row now being
lowercase, and the new filter value being accepted end to end.

`npm test` in `backend/`: 202 passing.
