# The admin Activity Logs page (#113)

## The defect

`activityLogModel` named the wrong model:

```js
userId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",          // userModel registers "user"
  required: false,
  index: true,
},
```

`getActivityLogsController` is the only reader, and it populates:

```js
.populate("userId", "name email type")
```

Mongoose resolves `ref` by exact name. `"User"` matched nothing, the populate
threw, the handler's `try` caught it, and `GET /api/admin/activity-logs`
answered:

```json
{ "success": false, "message": "Unable to retrieve activity logs." }
```

with this on the server:

```
MissingSchemaError: Schema hasn't been registered for model "User".
```

`ActivityLogs.jsx` calls that one endpoint, so the panel showed
`Activity logs could not be loaded. Please try again.` and never recovered.

It is the only mismatched `ref` in `backend/schemas` — every other one is
lowercase and resolves. Probably a copy of the model name two lines below it,
`mongoose.model("ActivityLog", ...)`, which is also the only capitalised
registration in the project.

## Why it survived #87

The failure is data-dependent, and the dependency runs the wrong way round from
what you would guess.

`recordActivity` omits the field entirely for a failed attempt:

```js
...(userId ? { userId } : {}),
```

Populating a set of documents whose paths are **all** null never resolves the
model, so it never throws. A database holding only failed logins renders the
page perfectly. The first *successful* sign-in writes the first row with a
`userId` on it, and from that moment the page is broken for good.

#87 built the write side — the IP, the User-Agent, the role normalisation, the
`login_failed` action — and tested it thoroughly. `backend/tests/activity-log.test.js`
exercises `recordActivity` and `getRequestContext`. Nothing read the rows back.

## The fix

### `backend/schemas/activityLogModel.js`

`ref: "User"` → `ref: "user"`. That is the entire functional change.

### `backend/utils/modelReferences.js` (new)

The part worth more than the one character. The reference graph is derivable
from the registered models, so it can be asserted instead of reviewed.

| export | does |
| --- | --- |
| `collectSchemaReferences(schema, modelName)` | every literal `ref` on one schema, including refs on array element types |
| `collectModelReferences(models)` | the same across a registry |
| `findUnresolvedReferences(models)` | the ones naming a model that is not registered |
| `describeUnresolvedReference(reference, names)` | a message that names the field, the target and what *is* registered |
| `verifyModelReferences({ models, logger })` | logs each one and returns them; does not throw |

A `refPath` is deliberately skipped: it names the *field* holding the model
name, so the target is only known per document and reporting it would be a
false positive on every run. There is a test for that.

### `backend/config/connect.js`

`verifyModelReferences()` runs next to the model requires, before a connection
is even opened — the graph is static, so nothing has to be reachable to check
it. Same reasoning as `ensureIndexes()` a few lines below: a misconfiguration
that only surfaces under real data should be loud once at start-up rather than
as a 500 in an endpoint nobody is watching.

It logs and returns rather than throwing. A bad `ref` breaks one populate, not
the whole API, and taking the server down for it would be a worse outcome than
the bug.

## Tests

### `backend/tests/model-references.test.js` (new, 12)

The sweep over the real schemas, plus the collector and the check in isolation
against stub registries. Confirmed to fail on the original code:

```
not ok 1 - every ref in the project names a registered model
    ActivityLog.userId references the model "User", which is not registered.
    Populating it throws MissingSchemaError. Registered models: ActivityLog,
    course, courseBookmark, coursePayment, courseReview, enrolledCourses,
    user, verificationAttempt
```

One test asserts the known edges are actually in the graph. A guard that
silently collects nothing would pass forever.

### `backend/tests/activity-log-listing.test.js` (new, 12)

The read side, which had none. The controller is mounted bare — who may reach
the route is `adminRoutes`' business and `admin-routes.test.js` already covers
it — and the tests go through sorting, both filters, their rejections, search
over the IP and User-Agent columns, regex escaping, pagination and the
past-the-end clamp.

Against the original `ref: "User"`, **8 of these 12 fail**. The 4 that pass are
the empty-log, failed-login-only and filter-rejection cases — which is the
data-dependency above, stated as tests.

The assertion that actually proves the ref resolves is this one:

```js
assert.equal(body.data[0].user.name, "Grace");
```

`name` is not stored on the log row. It can only come from the join.

## What did not change

The response body, every filter, every rejection message, and the write side.
No frontend change was needed — `ActivityLogs.jsx` has always been able to
render these rows, it just never received any.

## Verifying

```bash
cd backend && npm test    # 437 pass (413 before, 24 added)
```

Against a live database:

1. Sign in as any ordinary account, so one log row carries a `userId`.
2. Open the Activity Logs panel on the admin dashboard.

Before: `Activity logs could not be loaded. Please try again.`
After: the row, with the account's name resolved.

## Notes

- A row whose `userId` points at a deleted account is not the same as a row
  with no `userId`, and both share a page with ordinary rows. The controller
  already handled both through its `log.userId?._id` fallbacks; there is now a
  test holding all three shapes on one page.
- `verificationAttemptModel` is registered but not required by
  `config/connect.js`. The sweep covers whatever is registered, and the test
  file requires it explicitly so the check is meaningful when run on its own.
- The capitalised `mongoose.model("ActivityLog", ...)` registration is left
  alone. Nothing refs the activity log, so it is inconsistent rather than
  broken, and renaming a model is a migration-shaped change for a cosmetic
  gain.
