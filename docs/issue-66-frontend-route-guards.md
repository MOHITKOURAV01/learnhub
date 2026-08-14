# Issue #66 — Frontend route guards

## What was wrong

`App.jsx` decided what a signed-out visitor could reach by conditionally
*declaring* routes:

```jsx
{userLoggedIn ? (
  <>
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/courseSection/:courseId/:courseTitle" element={<CourseContent />} />
  </>
) : (
  <Route path="/login" element={<Login />} />
)}
```

That is not a guard. When `userLoggedIn` is false the route does not exist, so
React Router matches nothing and renders an empty `<div className="content">`.
A bookmarked dashboard, or a refresh after the session expired, produced a blank
page with the URL unchanged — indistinguishable from a crash.

Four more problems followed from the same design:

- `/saved-courses` sat outside the conditional block entirely, so a signed-out
  visitor mounted `SavedCourses` and it fired an unauthenticated bookmarks
  request.
- The login state came from `JSON.parse(localStorage.getItem("user"))` being
  truthy. `localStorage.setItem("user", "1")` was enough to render the signed-in
  shell, and the JWT in `localStorage.token` was never looked at, so an expired
  token behaved as a valid session until the first API call failed.
- There was no return-to-intended-page behaviour: every login landed on
  `/dashboard`.
- There was no catch-all route, so any unknown URL rendered nothing.

## What changed

### `src/auth/session.js`

One place that knows how to read, validate and clear a session.

`isTokenValid` decodes the JWT payload (base64url, padding fixed, wrapped in
try/catch) and compares `exp` against the clock with 30 seconds of leeway, so a
token that is about to expire is not used for a request that will land after it
has. The signature is deliberately *not* checked here — only the server can do
that, and only the server enforces it. This is about not rendering a signed-in
shell around a token the client already knows is dead.

`readSession` requires both a valid token and a stored user object that actually
has an id, which is what closes the `setItem("user", "1")` hole.
`clearSessionIfStale` throws away a session that no longer passes, so an expired
token does not sit in storage looking valid.

### `src/auth/authContext.js` and `src/auth/AuthProvider.jsx`

The context and `useAuth` hook live in a plain `.js` file with no component in
it, so Fast Refresh keeps working for the components that import them.

`AuthProvider` holds the session and keeps it current in two ways the old code
did not: a `storage` event listener, so signing out in one tab is reflected in
the others, and a one-minute interval that re-checks expiry, so a token that
dies while a tab is left open turns into a redirect at the next navigation
rather than a wall of failed requests.

### `src/auth/ProtectedRoute.jsx`

`ProtectedRoute` renders `<Navigate to="/login" replace state={{ from: location }} />`
for a signed-out visitor. `replace` keeps the guarded URL out of the history
stack so Back does not bounce between it and `/login`, and `state.from` is what
the login screen reads to send the user onward.

It also takes an optional `allowedRoles`. A signed-in user with the wrong role is
sent to `/dashboard`, not to a login form they have already completed.
`/saved-courses` uses `allowedRoles={["student"]}`, matching
`courseBookmarkRoutes.js`, which already restricts bookmarks to students — the
route now says so instead of letting the page mount and fail.

`PublicOnlyRoute` is the mirror image: it keeps a signed-in user off `/login`
and `/register`, returning them to `state.from` when there is one.

### `src/components/common/NotFound.jsx`

A real 404 screen on `path="*"`, with a way back that depends on whether the
visitor is signed in.

### `App.jsx`

Routes are declared unconditionally and wrapped in guards. `UserContext` is
still exported with its original `{ userData, userLoggedIn }` shape, so
`NavBar`, `Dashboard`, `UserHome`, `AllCourses`, `AddCourse` and `CourseContent`
did not have to change — it is simply fed from the validated session now.

### `Login.jsx`

Three lines: read `location.state?.from?.pathname` and navigate there after a
successful login instead of always going to `/dashboard`.

## Before and after

| Action while signed out | Before | After |
| --- | --- | --- |
| Visit `/dashboard` | blank page, URL unchanged | redirect to `/login`, returns to `/dashboard` after signing in |
| Visit `/saved-courses` | page mounts, unauthenticated API call | redirect to `/login` |
| `localStorage.setItem("user", "1")` | signed-in shell renders | still signed out |
| Expired token | dashboard renders until an API call fails | signed out, stale entries cleared |
| Visit `/anything-else` | blank page | 404 screen |
| Teacher visits `/saved-courses` | page mounts, API returns 403 | redirect to `/dashboard` |

## Files

- `frontend/src/auth/session.js`
- `frontend/src/auth/authContext.js`
- `frontend/src/auth/AuthProvider.jsx`
- `frontend/src/auth/ProtectedRoute.jsx`
- `frontend/src/components/common/NotFound.jsx`
- `frontend/src/App.jsx`
- `frontend/src/components/common/Login.jsx`
- `frontend/package.json` — `prop-types` promoted to a direct dependency, since
  the new components declare `propTypes` and the ESLint config treats
  `react/prop-types` as an error

## Testing

The frontend has no test runner yet, so this was verified by hand against
`npm run dev` with the backend running:

1. Signed out, visit `/dashboard` → lands on `/login`; sign in → lands back on
   `/dashboard`.
2. Signed out, visit `/saved-courses` → lands on `/login`, no bookmarks request
   in the network tab.
3. Console: `localStorage.setItem("user", "1")`, reload `/dashboard` → still
   redirected to `/login`.
4. Console: replace `token` with an expired JWT, reload → redirected, and both
   `token` and `user` are gone from storage.
5. Visit `/nope` → 404 screen.
6. Sign in as a teacher, visit `/saved-courses` → redirected to `/dashboard`.
7. Sign in, open a second tab, sign out in the first → the second tab drops to
   signed out on its next navigation.

`npm run build` succeeds. `npx eslint src/auth src/App.jsx src/components/common/NotFound.jsx`
reports no problems in the new files.
