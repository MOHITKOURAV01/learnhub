# Issue 72 — one account per email address

`users.email` had no unique index. The only thing standing between two
registrations and two accounts on the same address was this, in
`registerController`:

```js
const existsUser = await userSchema.findOne({ email: value.email });
if (existsUser) return res.send({ message: "User already exists", success: false });
// ...later...
await newUser.save();
```

A read, then a write, with nothing in between. Two requests that arrive together
both read "no such user" and both insert.

A second, quieter problem sat next to it. Registration stored the address
lowercased (`validateRegistration` normalises it, and the schema has
`lowercase: true`), but every lookup afterwards passed the raw request value
through: `findOne({ email: req.body.email })`. Signing in as
`User@Example.com` did not find the account created as `user@example.com`.

## What changed

### `utils/accountIdentity.js` (new)

One place that owns both halves of the fix.

- `normalizeEmail(value)` — trim and lowercase, and nothing more. It does not
  strip dots or plus-tags: a self-hosted domain may treat `a.b@` and `ab@` as
  two different people, and collapsing them would merge unrelated accounts.
- `buildEmailFilter(value)` — the filter every lookup now uses. An unusable
  value yields `{ email: "" }`, which matches nothing because the field is
  `required`. It deliberately does **not** return `null`: `findOne(null)` is
  `findOne({})` in Mongoose and would hand back an arbitrary account.
- `isDuplicateKeyError` / `duplicateKeyFields` / `isDuplicateOn` — read the
  driver's `E11000`. The shape differs between driver versions, so the reader
  checks `keyPattern`, then `keyValue`, then falls back to parsing the index
  name out of the message.

### `schemas/userModel.js`

`email` is `unique: true`. That is the constraint the race actually needed.

### `controllers/userControllers.js`

- `registerController` wraps `newUser.save()` and turns a duplicate on `email`
  into the same `"User already exists"` response the pre-check returns. Without
  this the race just changes shape, from a duplicate row into an opaque 500.
- `loginController`, `verifyOtpController`, `forgotPasswordController` and
  `resetPasswordController` all look up through `buildEmailFilter`, so casing
  no longer decides whether an account is found.

### `config/ensureIndexes.js` (new) and `config/connect.js`

Mongoose builds declared indexes in the background and emits failures on the
model. Nothing was listening, so on a database that already holds duplicates the
server would come up looking healthy with the constraint silently absent.

`ensureIndexes()` builds them explicitly after connecting and reports a failure
once, with the command that fixes it. `connect.js` requires every schema first
so a model no router touches cannot be skipped.

### `scripts/dedupeUserEmails.js` (new)

`npm run db:dedupe-emails` — the migration step the index needs on an existing
database.

- **Keeper**: verified beats unverified; between two of the same, the oldest
  wins, because that is the id enrolments and payments already reference.
- **Losers**: their enrolments, bookmarks, reviews, payments and activity logs
  are re-pointed at the keeper, then the row is deleted.
- Re-pointing can collide — both accounts enrolled in the same course, and
  `{ userId, courseId }` is unique. The loser's row is dropped in that case
  rather than duplicated.
- `courseModel.userId` is a `String` while every other reference is an
  `ObjectId`, so authored courses get their own pass.
- `-- --dry-run` reports without writing.

### Indexes added elsewhere

`coursePayments` was queried by `userId` and sorted by `createdAt` with no index
on either, and `courses` was filtered by `userId` and sorted three different
ways with none. Both are collection scans today.

## Order of operations on an existing deployment

```bash
cd backend
npm run db:dedupe-emails -- --dry-run   # review
npm run db:dedupe-emails                # apply
npm start                               # the index builds cleanly
```

Starting the server first is not harmful — it reports the collision and names
the command — but the constraint will not exist until the duplicates are gone.

## Tests

`tests/account-identity.test.js`, 15 cases: normalisation including non-string
input, the unmatchable-filter guarantee, all three `E11000` shapes, the startup
diagnostic, keeper selection, and a `mongodb-memory-server` case that inserts a
second account and asserts the index rejects it — including when the address is
cased differently.
