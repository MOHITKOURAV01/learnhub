# Issue 75 — the catalogue past course twelve

#43 made `GET /api/user/getallcourses` paginated, searchable, filterable and
sortable. The catalogue never picked any of it up:

```js
const res = await axiosInstance.get("/api/user/getallcourses");
setAllCourses(res.data.data || []);
```

`normalizePagination` defaults to `DEFAULT_LIMIT = 12`, so that response holds
twelve courses. `AllCourses.jsx` then filtered *those twelve* in a `useMemo`
and dropped `res.data.pagination` on the floor.

The consequences, in order of how much they matter:

- Course thirteen and everything after it could not be seen or enrolled in.
  There was no page control anywhere in the UI.
- The search box searched one page. Typing the exact title of a course on page
  two returned "No courses match that search".
- The `{n} courses found` counter maxed out at twelve.
- The Free/Paid filter used `/\d/.test(course.C_price)`, which calls a course
  priced `"Free for the first 100"` paid. The server's `FREE_PRICE_PATTERN`
  calls it free. The two halves of the same filter disagreed.
- No request was ever sent after the initial mount.

## What changed

All of it is on the client. The API already did the work.

### `lib/catalogQuery.js` (new)

The pure half — no React, so it can be tested on its own:

- `buildCatalogParams(state)` builds the query the server already understands,
  leaving empty values out rather than sending `""`.
- `readPagination(payload, fallbackCount)` reads the pagination block and fills
  in `totalPages` / `hasNextPage` when a response does not carry them.
- `clampPage(page, totalPages)` keeps the requested page inside the range that
  exists. Tightening a filter or deleting a course can leave the client asking
  for a page the server no longer has, which renders an empty grid that looks
  broken.
- `isPaidCourse(course)` mirrors `FREE_PRICE_PATTERN` from
  `backend/utils/courseListing.js`, so the client and the server now agree.
- `buildPageWindow(page, totalPages)` decides which page numbers to show. A
  course site accumulates pages and forty numbers in a row is not a control;
  the first, last and current pages are always present, so nothing is more than
  two clicks away.
- `describeRange(pagination, shown)` — "Showing 13–24 of 57 courses".

### `hooks/useCourseCatalog.js` (new)

Owns the query state and the request.

Two things it has to get right, neither of which is obvious from the outside:

**Debounce.** Without it the search box fires a request per keystroke. 350 ms
after the last one; the counter shows "searching…" while the delay is pending,
so the numbers on screen are never silently one keystroke stale.

**Stale responses.** A slow request for `"re"` landing after a fast one for
`"react"` would put the wrong results on screen. Every request takes a ticket
and only the newest one is allowed to write state.

It also resets to page one whenever the query changes — staying on page four
while switching to a filter with two pages of results shows an empty grid.

### `components/common/CatalogPager.jsx` (new)

Previous / numbered pages / Next, with `aria-current="page"` on the current
one and `aria-label` on each button.

### `components/common/AllCourses.jsx`

The client-side `useMemo` filter is gone; search, access filter and the new
sort control all go to the server. The counter reads `pagination.totalItems`
rather than the length of the loaded array. Enrolling triggers a reload so the
learner count on the card is not stale. The empty state distinguishes "nothing
matched your filters" from "there are no courses yet" and only offers "Clear
filters" in the first case.

### Tests

`frontend/package.json` gains `npm test`, running `node --test` over
`src/**/*.test.js`. No new dependency: Node's own test runner reads the ESM
modules directly. The React components still need a DOM and are not covered;
the arithmetic that decides what is reachable is.

`lib/catalogQuery.test.js` (17) and `lib/pageWindow.test.js` (5) cover query
building, the free/paid rule including the case the two implementations used to
disagree on, reading a response with and without a pagination block, clamping,
the counter's wording on the last page and for a single result, and an
exhaustive sweep asserting that for every page of every catalogue size up to
25, the current, first and last pages are all present in the window.

## Checking it by hand

1. Seed more than twelve courses.
2. Open the catalogue — a pager appears under the grid and the counter shows
   the real total.
3. Search for a course that used to be on page two. It is found now.
4. DevTools → Network: one request per 350 ms of typing, with
   `?page=1&limit=12&search=…` on it.
5. Go to the last page, then narrow the filter. The grid does not go blank; the
   page clamps to one that exists.
