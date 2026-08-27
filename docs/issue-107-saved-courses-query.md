# The saved-courses endpoint (#107)

## The defect

`getSavedCourses` read the user's entire bookmark collection on every request,
populated a course document for each row, and then did all of the work in Node:

```js
const bookmarkDocs = await CourseBookmark.find({ userId })
  .populate({ path: "courseId", select: "C_title C_categories C_educator C_description C_price enrolled createdAt updatedAt" })
  .sort({ createdAt: -1 })
  .lean();

let items = bookmarkDocs.map(...)

if (search)       { items = items.filter(...) }
if (category)     { items = items.filter(...) }
if (access)       { items = items.filter(...) }
if (availability) { items = items.filter(...) }

items.sort(sorters[sort]);

return res.status(200).send({ data: items.slice(start, start + limit), ... });
```

No `skip`, no `limit`, and every filter and sort applied to the fully
materialised list. `limit` defaults to 12 and is capped at 50, so the endpoint
read and populated N rows to return at most 50 — and `serializeCourse`, which
runs a regex per row through `parsePrice`, executed for every one of them to
produce those twelve. The `categories` list was rebuilt by walking all
bookmarks into a `Set`, and `title-asc` called `localeCompare` — `Intl`
collation, in JS — across the full list.

The load was multiplied by how the client uses it. `BookmarksProvider` calls the
endpoint on mount and again after every clear, and `SavedCourses.jsx` re-runs
`loadSavedCourses()` on each of the `learnhub:bookmark-change` and
`learnhub:bookmarks-cleared` window events. Saving five courses in a row on the
wishlist page triggered five full reads.

#96 fixed exactly this for the admin user and course lists. This endpoint and
`GET /api/admin/payments` were the two that were not part of that change.

## The fix

One aggregation. `$match` the user on the indexed `{ userId: 1, createdAt: -1 }`
→ `$lookup` the course, projecting eight fields rather than a document →
`$unwind` preserving the rows whose course is gone → `$addFields` the computed
availability, access type, numeric price and search text → `$facet` the rows,
the count and the category list.

### `backend/utils/bookmarkListing.js` (new)

| export | does |
| --- | --- |
| `parseSavedCoursesQuery(query)` | validates page, limit, search, category, access, availability and sort; reproduces every old rejection message |
| `ACCESS_EXPRESSION` | free vs paid, as `$regexMatch` |
| `PRICE_EXPRESSION` | the numeric price out of `C_price` — commas removed, first numeric run taken, free → `0` |
| `COMPUTED_FIELDS` | availability, access type, price, title and search text in one `$addFields` |
| `buildFilterStages(filters)` | the narrowing stages, returned as a list because two `$facet` branches need them and one deliberately does not |
| `buildBookmarkSort(sort)` | the sort, always with an `_id` tiebreak |
| `buildBookmarkPipeline(userId, filters, options)` | the whole pipeline |
| `bookmarkAggregateOptions(filters)` | the collation, for the title sorts |
| `toSavedCourseRow(row)` | shapes one projected row — over the page only |
| `readBookmarkFacet(facet, filters)` | the `$facet` document → `{ data, categories, pagination }` |
| `clampedPage(filters, totalItems)` | the page to retry with when the client asked past the end |

### `backend/controllers/courseBookmarkController.js`

`getSavedCourses` becomes parse → build → run → respond. `serializeCourse`,
`parsePrice`, `isPaidCourse`, the local `ALLOWED_SORTS` and the local
`parsePositiveInteger` are all gone — the pipeline expresses what they did.

The other four handlers — `addBookmark`, `removeBookmark`, `getBookmarkStatus`
and `clearBookmarks` — are untouched.

## Two details worth knowing

### The category list is deliberately unfiltered

`categories` populates the category dropdown, and the old code built it from
`bookmarkDocs` — **all** the user's bookmarks, before any filter ran. If it were
built from the filtered set, picking a category would remove every other option
from the control you just used, and there would be no way back.

So the `$facet` sits *before* the filter stages, and the filters are applied
inside the `rows` and `total` branches while `categories` runs without them.
There is a test asserting the list is identical filtered and unfiltered.

This also means the `$lookup` is bounded by the user's bookmark count rather
than by the page — the category list cannot be computed without the join. That
is inherent to the feature, not to this implementation. Everything else —
filtering, sorting, counting, slicing and shaping — now happens in the database,
and the join returns eight projected fields rather than whole course documents.

### `aggregate()` does not cast ids

`find()` casts a string id against the schema. `aggregate()` does not, and
`getUserId` returns `req.user._id.toString()`, so
`$match: { userId: "<hex string>" }` against an `ObjectId` field matches
**nothing** — silently, as an empty wishlist rather than as an error. The cast is
explicit in the controller, with a test that a real token's string id still finds
the user's bookmarks.

## What did not change

The response body. `data[].bookmarkId`, `data[].savedAt`, `data[].course`,
`categories`, `pagination` and `filters` keep the exact shapes
`SavedCourses.jsx` and `BookmarksContext.jsx` read, and every rejection message
is preserved verbatim. There is a test asserting the key set. No frontend change
was needed.

`isPaidCourse` was `/\d/.test(...)` — any digit anywhere. That loose rule is kept
rather than tightened: changing it would silently move courses between the free
and paid filters on data users have already saved.

## Verifying

```bash
cd backend && npm test    # 354 pass (314 before, 40 added)
```

Against a large wishlist:

```js
const bulk = [];
for (const courseId of allCourseIds) bulk.push({ userId, courseId, createdAt: new Date(), updatedAt: new Date() });
db.coursebookmarks.insertMany(bulk);
db.setProfilingLevel(2);
```

`db.system.profile` for a twelve-row page now shows a `$limit` stage, where it
previously reported the user's full bookmark count with no `limit` at all.

## Notes

- Sorts now carry an `_id` tiebreak. Without one, two courses saved in the same
  millisecond — ordinary, because the wishlist saves in bursts — could swap
  places between two requests and make a card appear on both page one and page
  two, or on neither.
- `title-asc` and `title-desc` run with `{ locale: "en", strength: 2 }`, so they
  behave like the `localeCompare` they replace rather than sorting every
  uppercase title first. Only those two sorts pay for the collation.
- `$unwind` uses `preserveNullAndEmptyArrays`, or a bookmark whose course was
  deleted would vanish instead of showing as unavailable — which is the entire
  point of the `deleted` availability filter.
- `escapeRegex` from `utils/courseListing` stays on both the search and the
  category path. The values go into regexes, and a bare `(` is enough to turn a
  search box into a 500; there is a test for it.
- `courseBookmarkModel` already indexes `{ userId: 1, createdAt: -1 }`, so the
  leading `$match` and the default sort are covered. No new index was needed.
