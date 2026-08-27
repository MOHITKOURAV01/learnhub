# Issue 73 — a way back from an unverified account

Registration mails a six-digit code that expires after ten minutes. If it was
missed, the account became unusable and stayed that way:

| What the user tries | What they got |
| --- | --- |
| Register again | `"User already exists"` |
| Log in | `"Email is not verified"`, `notVerified: true`, and no branch in the UI |
| Ask for a new code | there was no route |
| Forgot password | writes `resetToken`, which `verifyOtpController` never reads |

The frontend made it easy to land there. `Register.jsx` held the verify step in
`useState`, so a refresh — or reading the code in another tab and coming back —
discarded both `showOtpInput` and `data.email`. The code was sitting in the
inbox with nothing left that knew which address it belonged to.

The only recovery was a maintainer deleting the row.

## What changed

### `utils/otpCodes.js` (new)

Code length, lifetime, cooldown and the mail copy, in one place, so
registration and the resend route cannot drift apart.

`generateOtp()` uses `crypto.randomInt` rather than the previous
`Math.floor(100000 + Math.random() * 900000)`. `Math.random` is not a CSPRNG,
and this value is the only thing between an attacker and a verified account.
The range is unchanged, so the code is still exactly six digits.

`secondsUntilResend()` treats a timestamp in the future — clock skew between
app servers — as one cooldown, not as a lockout until that time passes.

### `controllers/emailVerificationController.js` (new)

- `issueVerificationOtp({ user })` writes the code, expiry and send time onto
  the document, saves it and mails it, or reports how long the caller must
  wait. Registration and the resend route both go through it.
- `POST /api/user/resend-otp` — the missing route.

The response is deliberately identical for an unknown address, an
already-verified account and a successful send. A route that answers "no such
account" is an account-enumeration oracle, and this one takes an address from
an anonymous caller. The only thing that varies is the 429, which a caller can
only provoke for an address they already put into cooldown.

The cooldown is one send per address per minute, derived from `otpLastSentAt`
on the user document. It is not a client-side timer, so clearing storage or
calling the API directly does not step around it.

### `controllers/userControllers.js`

`registerController` now distinguishes the two cases it used to collapse:

- **Verified account** → `"User already exists"`, unchanged. That address
  belongs to someone.
- **Unverified row** → a registration that was never completed. Nobody owns the
  address yet, so this is treated as the same person retrying. The name,
  password and account type are taken from the new attempt (they may be
  retrying because they mistyped something), and a fresh code goes out.

`verifyOtpController` clears `otpLastSentAt` on success, compares the code
after trimming, and returns `canResend` so the UI knows whether offering a
"send a new code" button will do anything or only answer 429.

### `schemas/userModel.js`

`otpLastSentAt`, `select: false` like the other credential fields, and stripped
in `toJSON` alongside them.

### `components/common/VerifyEmailPanel.jsx` (new)

The verify step is reached from two places now — after registering, and after a
sign-in attempt on an unverified account — so it is one component rather than
two copies.

It holds the pending address in `sessionStorage`. That is what makes a refresh
survivable: the panel comes back on reload with the address it was working on.
The value is an address the user just typed into a form on the same page, so
there is nothing there they did not already know.

Resend is disabled while the cooldown runs and counts down in the button, and
the count is seeded from the server's `retryAfterSeconds` when a 429 comes
back, rather than being guessed by the client.

### `Register.jsx` and `Login.jsx`

- Register drops the four `alert()` calls for the `Toast` that #36 introduced,
  disables the submit button while the request is in flight, and checks the
  six-character password rule before sending.
- Login adds a `verify` view. `notVerified: true` was already in the response;
  now something reads it.
- The password field on Register was `autoComplete="current-password"` on a
  sign-up form; it is `new-password`.

## Verifying by hand

```bash
# 1. Register, then never enter the code.
curl -X POST localhost:5000/api/user/register -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"stuck@example.com","password":"password123","type":"student"}'

# 2. The address is no longer stranded.
curl -X POST localhost:5000/api/user/resend-otp -H 'Content-Type: application/json' \
  -d '{"email":"stuck@example.com"}'
# -> 200 "If that address needs verifying, a new code is on its way."

# 3. Immediately again.
curl -X POST localhost:5000/api/user/resend-otp -H 'Content-Type: application/json' \
  -d '{"email":"stuck@example.com"}'
# -> 429 { retryAfterSeconds: 5x }

# 4. An address nobody registered answers exactly like step 2, and sends nothing.
curl -X POST localhost:5000/api/user/resend-otp -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.com"}'
```

In the UI: register, press F5 on the verify screen, and the step is still there
with the address intact.

## Tests

`tests/otp-resend.test.js`, 15 cases: code shape over 500 draws, expiry
arithmetic, cooldown including the future-timestamp case, that issuing inside
the cooldown neither writes nor mails, that unknown and already-verified
addresses produce byte-identical responses, and that a database failure does
not leak the driver's message into the body.
