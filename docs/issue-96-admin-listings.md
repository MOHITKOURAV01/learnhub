# The admin list endpoints (#96)

## The defect

Every list endpoint in this project has been paginated as it was touched — #43
for the catalogue, #65 for enrolments, and reviews, payments and activity logs
when they were written. The three the admin dashboard depends on were not:

```js
const allUsers = await userSchema.find().select(PUBLIC_USER_PROJECTION);
const allCourses = await courseSchema.find();
const enrolled = await enrolledCourseSchema
  .find()
  .populate("userId", "name email")
  .populate("courseId", "C_title");
```

No `skip`, no `limit`, no filter, no sort. At a few hundred rows this is a slow
page; nothing in the code makes it stop being one at a few hundred thousand.

`getallcourses` had no projection either, so it returned the full course
document — every section's `S_title`, `S_description` and `S_content.path` — to
render six scalars and a count. Those paths are the same ones #76 is about,
handed to the client for no reason the UI has.

The clients rendered the lot: `AdminHome.jsx` mapped every user into a
`<StyledTableRow>` and `admin/AllCourses.jsx` did the same with every course.
Neither windowed, neither paged, and neither offered a search — finding one
account among many meant Ctrl-F against a fully materialised DOM.

`admin/AllCourses.jsx` also never got the error handling `AdminHome.jsx` was
given:

```jsx
if (res.data.success) { setAllCourses(res.data.data) }
else { alert(res.data.message) }
} catch (error) { console.log(error); }
```

No loading state, a blocking `alert()` on a handled failure, a bare
`console.log` on a thrown one, `{Course.sections.length}` — `undefined` for an
object-shaped `sections`, a `TypeError` when the field is absent — and an empty
state reading **No users found** on the courses table.

## The fix

### `backend/utils/adminListing.js` (new)

| export | does |
| --- | --- |
| `buildUserFilter(query)` | escaped search over name and email, a closed role filter, a tri-state verified filter |
| `buildUserSort(query)` | a closed set with `_id` as a stable tiebreak |
| `ADMIN_COURSE_FIELDS` | the projection for the course table |
| `toAdminCourseRow(course, countSections)` | one row, `sectionCount` instead of `sections` |
| `toAdminEnrollmentRow(enrollment)` | one row, with an `orphaned` flag |

The course search and sort are **not** new: `getAllCoursesController` now calls
`buildCourseFilter` and `buildCourseSort` from `utils/courseListing.js`, the
same rules the public catalogue uses since #43. An admin looking for a course
and a visitor looking for one get the same answers rather than two
implementations that drift.

Only the user rules are new. `escapeRegex` is not optional there either: an
unescaped search value goes straight into a `RegExp`, and a single `(` throws —
which would surface as a 500 on a search box.

The verified filter is a **tri-state**, not a truthiness check: `unverified`
has to mean `isVerified: false`, not "absent from the filter", or the option
does nothing.

`toAdminEnrollmentRow` flags a row whose user or course has been deleted.
`populate()` resolves a dangling reference to `null`, which is how the
dashboard ended up rendering rows with a blank name and a blank course title.

### `backend/controllers/adminController.js`

All three endpoints return the project's pagination envelope. `getallusers`
also returns a `summary`:

```js
const summarizeUsersByRole = async (filter) => {
  const rows = await userSchema.aggregate([
    { $match: filter },
    { $group: { _id: "$type", count: { $sum: 1 } } },
  ]);
  ...
};
```

One `$group` across the whole filter, so the dashboard can say how many
educators and students there are without loading every account and counting
them in the browser — which is exactly what it was doing.

`PUBLIC_USER_PROJECTION` is unchanged: the point here is the row count, not a
new field leak, and the existing test that asserts no sensitive field escapes
still passes untouched.

### Frontend

`frontend/src/hooks/useAdminList.js` is one request owner for both tables. They
did the same thing differently — both fetched everything on mount, one handled
errors and the other logged them, and neither paged — so the paging, the
debounce, the stale-response guard and the error handling live here once and
each table supplies its endpoint, its params builder and its row reader.

`frontend/src/lib/adminListing.js` builds the params and normalises the rows.
Every field gets a usable default, and `sectionCount` reads as `0` rather than
`NaN` or `undefined`.

`AdminHome.jsx` and `admin/AllCourses.jsx` both get a search box, filters, a
sort, a range line, `CatalogPager`, distinct loading and error states, an
in-page confirmation dialog instead of `confirm()`, and `Toast` instead of
`alert()`. The courses table's empty state no longer says *No users found*.

One behavioural change worth calling out: the admin course table now deletes
through `DELETE /api/admin/deletecourse/:courseid` rather than the teacher
route it was borrowing. Both are wired to the same `deleteCourseController`,
which has always accepted an admin; the admin route additionally runs
`validateObjectId`, so a malformed id is a 400 rather than reaching Mongoose.

## Tests

`backend/tests/admin-listing.test.js` — 22 tests.

Unit: search escaping, an empty search adding no clause, a closed role filter,
the tri-state verified filter, closed sorts with stable tiebreaks, a course row
carrying a count and never a section list, all three `sections` shapes, blanks
filled in, an orphaned enrolment flagged, a complete one not.

Integration, against `mongodb-memory-server`:

- 40 accounts, `?page=2&limit=10` → **10 rows**, and a correct `pagination`
  block. On `main` this returned 40 whatever the query string said.
- `?limit=100000` is capped at 100.
- a search for an account on page three finds it — the search runs on the
  server, over every account.
- `?search=(unclosed` is a 200, not a 500.
- the role filter narrows both the rows and the totals.
- the role summary covers 20 accounts while the page holds 5.
- `?sort=name` is applied by the database.
- the course list pages, and `JSON.stringify(response.body)` contains no
  `/uploads/` anywhere.
- the admin course search and the free/paid filter behave exactly as the
  catalogue's do.
- the enrolment list pages and flags a row whose course has been deleted.

`frontend/src/lib/adminListing.test.js` — 17 tests over the params and the row
readers.

Backend: 256 passing (234 before). Frontend: 90 passing (73 before). The
existing `admin-auth` and `admin-routes` suites pass unchanged.

## Verifying by hand

1. Seed, then
   `for (let i = 0; i < 5000; i++) db.users.insertOne({name: "User " + i, email: "u" + i + "@example.com", password: "x", type: "student", isVerified: true, createdAt: new Date(), updatedAt: new Date()})`.
2. Open the dashboard. The Users tab renders 20 rows and a pager, and the
   summary line reads the true total. On `main` the tab hangs while 5000 rows
   are parsed and mounted.
3. `curl -s -H "Authorization: Bearer <ADMIN_TOKEN>" 'localhost:5000/api/admin/getallusers?page=2&limit=20' | jq '.data | length'`
   → `20`. On `main`, `5004`.
4. Search `u4999@example.com` — found, from page 250.
5. `curl -s -H "Authorization: Bearer <ADMIN_TOKEN>" localhost:5000/api/admin/getallcourses | jq '.data[0]'`
   → `sectionCount`, and no `sections`.
6. Stop the backend and open the Courses tab → an error panel with a retry, not
   a blank table headed *No users found*.
