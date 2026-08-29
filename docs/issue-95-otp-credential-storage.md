# One-time codes: storage, comparison and disclosure (#95)

## The defect

### Every pending code was a live credential on disk

`registerController` and `forgotPasswordController` both did this:

```js
const otp = Math.floor(100000 + Math.random() * 900000).toString();
const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
const newUser = new userSchema({ ..., otp, otpExpiry });
```

`userModel` marks the field `select: false`, and #54 removed it from the admin
projection. Both are about what a *query* returns. Neither changes what is
written. A database backup, a replica with read-only credentials, or a
`mongodump` in a CI artefact carried a working credential for every account
with a pending code: the holder can complete `/verify-otp` or `/reset-password`
for each of them without ever seeing the mailbox.

`Math.random()` is also not a source to draw a credential from. V8 seeds
xorshift128+ in a way that an attacker who has observed a handful of outputs
can work backwards from, and nothing about that guarantee is written down.

### The endpoints confirmed which addresses had accounts

```js
// verifyOtpController
if (!user) return res.status(404).send({ message: "User not found", success: false });
if (user.otp !== otp || ...) return res.status(400).send({ message: "Invalid or expired OTP", ... });
```

`resetPasswordController` did the same. Two different status codes and two
different messages, on an unauthenticated and unthrottled endpoint, is an
account-enumeration oracle: one request confirms or denies any address.

`forgotPasswordController` in the same file already answered uniformly —
*"If that email exists, an OTP/reset token has been sent."* — so the project had
already decided this matters. The other two never got the same treatment.

### And the rest

- `user.otp !== otp` is a plain `!==` on secret material.
  `adminController.safeEquals` exists in this codebase for exactly this.
- Nothing counted attempts. A 6-digit code is 10⁶ and lives for ten minutes.
  #63 proposes an IP-based limiter, which bounds a single source; it does not
  bound guesses spread across many sources against one account.
- `verifyOtpController` returned early for a verified account without clearing
  an `otp` that might still be live on the document.
- `resetPasswordController` set `isVerified = true` as an unexplained side
  effect.

## The fix

### `backend/utils/otpCredentials.js` (new)

| function | does |
| --- | --- |
| `generateCode()` | six digits from `crypto.randomInt` |
| `issueCredential({ttlMs})` | `{ code, hash, expiresAt, attempts: 0 }` — the plaintext is returned once, for the email, and never persisted |
| `verifyCredential(stored, candidate)` | `{ status, attempts, shouldClear }` |
| `isWellFormedCode(candidate)` | shape check before any comparison |
| `burnComparison()` | one bcrypt comparison against a decoy hash |
| `isFailure(status)` | everything except `OK` — fails closed for a status added later |

`verifyCredential` returns one of `OK`, `INVALID`, `EXPIRED`, `LOCKED`,
`MISSING`. The callers answer **all four failures identically**, so the
distinction exists for the audit trail and never for the client.

`shouldClear` is the invalidation rule in one place. A credential dies when it
is used, when it expires, and when it reaches `MAX_ATTEMPTS` — the last matters
because a locked-but-live code is a code somebody can keep working on. An
unusable or missing `expiresAt` counts as expired, not as valid.

`burnComparison` is the part that is easy to leave out. Uniform responses are
only uniform if they also take the same time; without a decoy comparison on the
"no such account" path, the *absence* of a bcrypt call is the new oracle. The
decoy hash is computed once at module load.

### Schema

`otp` and `resetToken` now hold a bcrypt hash. `otpAttempts` and
`resetTokenAttempts` are new, both `select: false` and both **without a
default** — an absent counter means no pending code, and `$unset` has to mean
gone. `verifyCredential` reads a missing value as zero.

`toJSON` and `adminController.SENSITIVE_USER_FIELDS` both grew the two new
fields, and the admin reset-password `$unset` clears the counter with the token.

### Controllers

- **register** issues a credential and stores `credential.hash`; the plaintext
  reaches the mailbox and nothing else.
- **verify-otp** answers `400 "Invalid or expired OTP"` for an unknown address,
  a wrong code, an expired code, a locked account and a missing code — the same
  status, the same body, after the same work. A verified account has any
  leftover code cleared. On success, `isVerified` and the `$unset` are one
  atomic update.
- **forgot-password** stores the hash and **resets the attempt counter**, so an
  account that hit the limit can recover by asking for a new code. Its uniform
  response is unchanged.
- **reset-password** answers `400 "Invalid or expired reset token/OTP"` for an
  unknown address, where it used to answer `404 "User not found"`. On success it
  writes the new password, clears the reset credential **and any pending
  verification code**, and sets `isVerified` — that last was already the
  behaviour and is now stated: holding the code proves control of the mailbox.
- The 500 path no longer echoes `error.message` to the client.

## Migration

There is none, and none is needed. A plaintext code left over from before this
ships simply fails `bcrypt.compare` and the account is told the code is invalid
— which it now is. The user requests a new one and gets a hashed credential.
This fails closed, which is the correct direction for a credential change.

## Tests

`backend/tests/otp-credentials.test.js` — 23 tests.

Unit:

- codes are six digits, never leading-zero, and not a constant;
- only a bcrypt hash is issued for storage, and it verifies the code;
- a correct code returns `OK` and is marked spent;
- a wrong code increments the counter; the limit sets `shouldClear`;
- a credential already at the limit is `LOCKED` even for the correct code;
- an expired one is `EXPIRED`; a missing, null, `NaN` or non-numeric expiry is
  treated as expired rather than valid;
- no stored credential is `MISSING` and never `OK`;
- a malformed candidate — wrong length, letters, a number, `null`, an object —
  costs an attempt and never matches;
- `isFailure` fails closed on an unknown status.

Integration, against `mongodb-memory-server`:

- **registration stores a hash, and the stored value is not six digits**;
- a bare `find()` returns neither the hash nor the counter, and neither
  survives `JSON.stringify`;
- **an unknown address and a wrong code produce byte-identical responses** —
  on `main` these were 404 and 400;
- the correct code verifies the account and spends the credential;
- five wrong attempts destroy it, and the correct code then fails;
- an expired code reads the same as a wrong one;
- a code left on a verified account is cleared;
- forgot-password stores a hash and resets a counter that was at 4;
- reset-password no longer distinguishes an unknown address;
- a valid reset code works once, clears the pending OTP too, and replaying it
  leaves the first password in place.

257 passing, up from 234 on `main`.

## Verifying by hand

1. Register `a@example.com`.
2. `db.users.findOne({email:"a@example.com"}, {otp:1})` → a `$2a$10$…` hash.
   On `main` this is the six digits that were emailed.
3. `curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:5000/api/user/verify-otp -H 'Content-Type: application/json' -d '{"email":"nobody@example.com","otp":"000000"}'`
   → `400`. On `main`, `404`.
4. The same call for `a@example.com` → `400`, with the same body. The oracle is
   gone.
5. Send five wrong codes, then the right one → still refused, and `otp` is gone
   from the document.
6. `POST /api/user/forgot-password` → a new code, and `resetTokenAttempts` back
   to 0.
