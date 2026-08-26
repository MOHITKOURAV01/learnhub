# Saved-course status on the client (#103)

## The defect

`BookmarksProvider` is the single source of truth for whether a course shows a
filled star. It loaded that truth once, from one page of the wishlist:

```js
const response = await axiosInstance.get("/api/bookmarks?limit=50");

const ids = (response.data.data || [])
  .map((item) => item.course?.id)
  .filter(Boolean);

setBookmarkIds(new Set(ids));
```

`GET /api/bookmarks` is paginated and sorted `recent` first, and
`parsePositiveInteger(req.query.limit, 12, 50)` caps `limit` at 50 — so the
request could not have asked for more even if it had wanted to. Everything the
provider exposed was derived from that truncated set: `isBookmarked()`,
`bookmarkCount`, and `aria-pressed` on every `BookmarkButton`.

For a student with 51 or more saved courses, every course outside the fifty most
recently saved:

- rendered `☆` and `aria-pressed="false"` while actually being saved;
- could not be un-saved. `toggleBookmark` read `wasBookmarked = false` from the
  same Set and sent `POST /api/bookmarks/:courseId`. `addBookmark` is a
  `findOneAndUpdate(..., { upsert: true })`, so the row was already there,
  `created` came back `false`, and nothing changed. The star flipped in local
  state only and was hollow again after a reload.

The count had the same origin. `SavedCourses.jsx` printed `bookmarkCount` in its
header and `pagination.totalItems` in the result summary a few lines below, and
those came from different places — the truncated Set and the server's real
count. One screen, two numbers.

`getBookmarkStatus` in `backend/controllers/courseBookmarkController.js` has
answered exactly this question since the wishlist was built — "of these course
ids, which are saved", up to a hundred ids in one indexed query, wired at
`GET /api/bookmarks/status`. Nothing in `frontend/` called it:
`grep -rn "bookmarks/status" frontend/src` returned nothing.

## The fix

No backend change. The endpoint was already right; it was not being used.

### `frontend/src/lib/bookmarkStatus.js` (new)

The pure half of talking to `/api/bookmarks/status`, unit tested without a
browser or a network.

| export | does |
| --- | --- |
| `MAX_STATUS_IDS` | mirrors the hundred-id cap the endpoint enforces |
| `emptyStatus()` | the empty two-set state |
| `normalizeCourseId(value)` | `_id`, `id`, ObjectId or string → one string form, `''` when unusable |
| `collectPendingIds(requested, { resolved, inFlight })` | the ids that still need an answer, de-duped, order kept |
| `chunkIds(ids, size)` | splits a long list into batches the endpoint accepts |
| `buildStatusParams(ids)` | the query, or `null` when there is nothing to ask |
| `readStatusIds(payload)` | the saved ids out of a reply |
| `readSavedTotal(payload)` | the real count out of `pagination.totalItems`, `null` when absent |
| `mergeStatus(state, { requested, saved })` | folds one answer in |
| `applyToggle(state, courseId, bookmarked)` | records a local change |
| `applyClear(state)` | records "clear all" |
| `adjustTotal(total, delta)` | moves the count, never below zero |

The state is two sets rather than one, and that is the whole fix in one line.
**Saved**, **known not to be saved** and **not asked about yet** are three
different things, and the old code collapsed the last two. An unanswered id is
not an unsaved one.

### `frontend/src/context/BookmarksContext.jsx`

- `trackCourses(ids)` replaces the single up-front page read. Ids gather over the
  current tick and go out as one batched request, so a twelve-card catalogue page
  costs one lookup rather than twelve — the shape `useRatingSummaries` already
  uses for the rating badges.
- `inFlightIds` stops a re-render between a request and its reply from asking
  about the same ids again.
- `sessionVersion` invalidates the whole cache, negative answers included, when
  the session changes, and discards a reply that belongs to the previous account.
- `refreshBookmarks()` now reads only the count, with `limit=1`. It no longer
  pretends to load the id set.
- `bookmarkCount` is the server's number. `SavedCoursesNavLink` and the wishlist
  header read the same value the result summary does.
- A failed lookup leaves the ids **unresolved**, so the next page view asks
  again rather than caching a wrong answer.

The exported value keeps its existing shape — `bookmarkIds`, `bookmarkCount`,
`isBookmarked`, `toggleBookmark`, `removeBookmark`, `clearAllBookmarks`,
`refreshBookmarks`, `loading`, `ready`, `isAuthenticated` — with `trackCourses`
added. `SavedCourses.jsx`, `SavedCoursesNavLink.jsx` and `BookmarkButton.jsx`
needed no other change.

### `frontend/src/components/bookmarks/BookmarkButton.jsx`

Registers the course it is rendering. Three lines; the batching lives in the
provider.

## Verifying

```bash
cd frontend && npm test    # 143 pass (112 before, 31 added)
cd frontend && npm run build
```

By hand, with 51 or more saved courses:

1. Open `/` and find the course saved **first** — it sorts last under `recent`.
   Its star is filled. Before this change it was hollow.
2. Click it. The star empties, `DELETE /api/bookmarks/:id` goes out, and it is
   still empty after a reload. Before, the click sent a `POST` that changed
   nothing.
3. Open `/saved-courses`. The header and the result summary agree.
4. Watch the network panel while the catalogue loads: one request to
   `/api/bookmarks/status` for the page, not one per card.

## Notes

- `MAX_STATUS_IDS` duplicates a constant, not a rule. The server still rejects a
  request carrying more than a hundred ids; splitting on the client keeps the
  tail of a long list from silently rendering as unsaved.
- Optimistic toggling is unchanged. The bug was the value the toggle started
  from, not the toggle.
