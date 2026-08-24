# Issue 86 — one rating request per card

Every course card in the catalogue mounted a `CourseRatingBadge`, and every
badge fetched its own rating:

```jsx
useEffect(() => {
  if (!courseId) return undefined;
  axiosInstance.get(`/api/reviews/${courseId}/summary`).then(...)
}, [courseId]);
```

A catalogue page holds twelve cards (`DEFAULT_LIMIT = 12`), so opening the home
page issued **thirteen** requests: one for the courses, twelve for ratings. Each
of the twelve ran its own aggregation:

```js
const [summary] = await CourseReview.aggregate([
  { $match: { courseId: objectId } },
  { $group: { _id: "$courseId", averageRating: { $avg: "$rating" }, ... } },
]);
```

including for the courses with no reviews at all, which is most of them. Every
settled search query re-mounted up to twelve badges and fired twelve more, and
paging did the same. All of it anonymous, on the app's most exposed page — the
catalogue renders for signed-out visitors on `/` as well as for signed-in
students through `UserHome`.

## What changed

Thirteen requests per page becomes two. Twelve aggregations becomes one.

### `backend/utils/reviewSummaries.js` (new)

- `buildSummaryPipeline(courseIds)` — `$match: { courseId: { $in } }` followed by
  the same `$group` keyed by `courseId`. One indexed pass:
  `courseReviewSchema` already carries `{ courseId: 1, createdAt: -1 }`.
- `normalizeCourseIds(raw, { max })` — the ids come from the client, so the list
  is validated per id, de-duplicated and capped at 60. Unusable ids are
  *dropped* rather than rejected: one bad id in a list of twelve should not fail
  the whole page, and the caller gets an empty summary for it, which is what it
  would have got anyway.
- `buildSummaryMap(courseIds, rows)` — fills in an explicit empty summary for
  every requested course that has no reviews, so the client does not have to
  tell "no reviews yet" apart from "this id was missing from the response".

`getSummary` — the single-course path — now runs the same pipeline, so the two
endpoints cannot report different numbers. There is a test asserting they agree.

### `GET /api/reviews/summaries?courseIds=a,b,c`

Registered **before** `GET /:courseId` in the router. Declared after it,
`summaries` matches the parameter, `validateCourseId` rejects it, and the batch
route is unreachable — the same shadowing that made
`DELETE /api/admin/deleteuser` unauthenticated in #53. There is a test for it.

### `hooks/useRatingSummaries.js` (new)

One request for the ids currently on screen. Keyed on the joined id list rather
than on the array's identity, so paging back to a page already seen does not
re-request it, and a slow response for the previous page cannot overwrite the
current one.

A failed request is swallowed on purpose: a rating is decoration on a course
card, and the cards should still render. Every badge falls back to "New".

### `CourseRatingBadge`

Takes an optional `summary` and makes no request when it has one. The
self-fetching path stays for the single-course case, where there is no page to
batch with.

## Tests

- `backend/tests/review-summaries.test.js`, 14 tests: id normalisation
  (duplicates, bad ids, the cap), the shape of the aggregation, the empty-summary
  fill-in, and four through the real router — including that the batch route is
  not shadowed and that it agrees with the single endpoint.
- `frontend/src/lib/ratingSummaries.test.js`, 10 tests, mostly about not
  rendering `NaN stars` when a response is partial or malformed.

`npm test`: 198 in `backend/`, 32 in `frontend/`.
