# Issue 84 — the blank dashboard

Signing in and landing on `/dashboard` produced the navbar and an empty panel,
for every account and every role.

`UserHome.jsx` chose what to render by switching on the stored role:

```jsx
switch (user.userData.type) {
   case "Teacher": content = <TeacherHome />; break;
   case "Admin":   content = <AdminHome />;   break;
   case "Student": content = <StudentHome />; break;
   default: break;              // content stays undefined
}
```

Nothing stores `"Teacher"`. The #55 registration hardening put two lowercasing
steps in front of every write — `validateRegistration` does
`asTrimmedString(body.type).toLowerCase()`, and `userModel` declares

```js
type: { type: String, lowercase: true, enum: { values: ["student", "teacher", "admin"] } }
```

so the login response comes back `type: "student"`. No case matched, `content`
was `undefined`, and React rendered nothing. No exception, no failed request:
it looked like a page that never finished loading.

The same literals were compared in three more places:

- `NavBar.jsx` guarded the Add Course, Courses and Enrolled Courses links, so
  none of them rendered — a teacher had no route to the Add Course form at all.
- `Dashboard.jsx` guarded the `addcourse` and `cousres` cases, which fell
  through to `<UserHome />`, itself blank for the same reason.
- `session.js` carried the comment *"Roles are stored capitalised ("Teacher")
  but compared lowercase everywhere"*. Only the second half was true, and only
  of that module. `normalizeRole` there is why `ProtectedRoute` kept working,
  and therefore why the blank page was reachable at all.

## What changed

### `lib/roles.js` (new)

One place that answers "what is this account":

- `ROLES` — the three values the API stores.
- `normalizeRole(role)` — trims and lowercases, tolerates non-strings. This is
  a comparison rule, not a migration: documents written before #55 may still
  hold `"Teacher"`, and both spellings normalise to the same value, so nothing
  has to be rewritten.
- `getUserRole(user)` — reads `type`, falling back to a `role` alias.
- `isRole(user, role)` / `hasAnyRole(user, roles)` — with an emptiness guard, so
  a user with no role does not match an empty expectation. Without it
  `normalizeRole('') === normalizeRole(undefined)` and a roleless account would
  pass every check.
- `roleLabel(role)` — the display form, derived rather than stored, because
  "Signed in as student" reads badly.

`session.js` re-exports `normalizeRole` from here rather than declaring its own,
so `ProtectedRoute` keeps its import and there is a single rule.

### The four call sites

`UserHome`, `NavBar`, `Dashboard` and `Register` compare through the helpers.
Two changes are worth calling out beyond the substitution:

- `UserHome`'s default branch renders a message instead of nothing. Rendering
  nothing is exactly what made this so hard to see.
- `NavBar`'s `if (!user)` never fired — the context value is always an object.
  What needed guarding was `user.userData`, which is null when there is no
  session.

`Register` posts the value the API actually stores and capitalises the dropdown
label separately. It is harmless either way once comparisons are normalised, but
sending a spelling that survives only as far as the schema is misleading.

`Dashboard` also loses two imports it never used (`StudentHome`, `AdminHome`)
and the commented-out first draft of the component at the top of the file.

## Tests

`frontend/src/lib/roles.test.js`, 10 tests. The ones that matter are the pair
covering both spellings — lowercase from a current account, capitalised from an
older one — and the emptiness guard. `npm test` in `frontend/`: 32 passing.

There is no assertion that could have caught the original bug in place, because
it threw nothing and requested nothing. The helpers exist so there is now
something to assert against.
