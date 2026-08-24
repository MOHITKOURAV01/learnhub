# Issue 85 — My Courses past enrolment twelve

#65 rewrote `GET /api/user/getallcoursesuser` into a paginated endpoint that
also computes a progress summary for every row:

```js
return res.status(200).send({
  success: true,
  data,          // each row: + enrolledAt, courseLength, certificateDate,
                 //   progress { completed, total, percent }
  pagination: buildPaginationMetadata({ page, limit, totalItems }),
});
```

`EnrolledCourses.jsx` still called it bare and read two fields off each row:

```js
const res = await axiosInstance.get('/api/user/getallcoursesuser')
if (res.data.success) setAllEnrolledCourses(res.data.data)
```

`normalizePagination` defaults to `DEFAULT_LIMIT = 12`, so the response held
twelve enrolments and the `pagination` block was dropped — the same shape of
bug as #75, one screen over.

What that cost:

- A student with more than twelve enrolments could not reach the thirteenth.
  No pager, no way to ask for page two.
- `progress`, `enrolledAt`, `courseLength` and `certificateDate` were all in
  the response and none were rendered. Completing a section changed nothing on
  screen.
- A thrown request was a `console.log`, so a 500 left an empty table and a
  silent console.
- The link into the player interpolated the title straight into the path, so a
  course called `"Node.js: HTTP/2 in practice"` produced a URL with an extra
  segment and the route matched something else.
- The widest column was Course ID, which no learner needs, and the Educator
  header read `Cousre Educator`.

## What changed

### `lib/enrolledCourses.js` (new)

The pure half, no React:

- `readProgress(row)` normalises the block. The client cannot assume it is
  there — a partial response, or a row cached from before #65, has none — so it
  falls back to `courseLength` rather than rendering `0 of undefined`.
  `percent` is **recomputed** rather than trusted, because a percent that
  disagrees with the counts puts the bar and the label under it in
  contradiction. `completed` is capped at `total`: progress rows written before
  #39 had no uniqueness guard and can hold the same section twice.
- `progressState` / `describeProgress` — a course with no sections says "No
  sections yet" instead of claiming 0 of 0, which would otherwise read as
  complete.
- `courseHref(row)` encodes both segments.
- `describeEnrolledRange` counts the whole collection, not the loaded page.

### `hooks/useEnrolledCourses.js` (new)

Owns the request, the page state and the failure state. Two things it has to
get right:

- **Stale responses.** A slow request for page one landing after a fast one for
  page two would put the wrong rows on screen. Every request takes a ticket and
  only the newest may write state.
- **Clamping.** A course being deleted can leave the client asking for a page
  the server no longer has; without clamping the table renders empty and looks
  broken. `clampPage` and `readPagination` are reused from `lib/catalogQuery`
  rather than reimplemented.

A 401 is left alone: the axios interceptor already clears the session and
redirects, so reporting it here would flash an error on the way out.

### `EnrolledCourses.jsx`

Progress column with a bar and a `3 of 8 sections · 38%` label, an enrolment
date, the pager, and distinct loading / error / empty states. Course ID is
gone, and the header typo with it.

### `CatalogPager`

Gains an optional `label` for the `aria-label`, since the control was never
catalogue-specific — only its wording was. It also gains the `propTypes` it
should have had.

## Tests

`frontend/src/lib/enrolledCourses.test.js`, 16 tests, weighted towards the
cases that produce a wrong number on screen rather than an error: a percent
that disagrees with its counts, duplicate progress rows pushing `completed`
past `total`, a course with no sections, and a title containing a slash.

`npm test` in `frontend/`: 38 passing. `npm run build` passes. `npm run lint`
goes from 69 problems on `main` to 61, because both files this branch touches
now carry `propTypes`.
