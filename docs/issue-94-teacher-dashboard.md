# The educator dashboard (#94)

## The defect

`TeacherHome.jsx` is the page an educator lands on after signing in. It was the
last list in the project that never got the treatment #43, #65, #75 and #85
gave every other one.

### A failed request looked exactly like having no courses

```jsx
const getAllCoursesUser = async () => {
   try {
      const res = await axiosInstance.get(`/api/user/getallcoursesteacher`);
      if (res.data.success) { setAllCourses(res.data.data); }
   } catch (error) {
      console.log('An error occurred:', error);
   }
};
```

No loading state, no error state, no `else`. A 500, a dropped connection or an
expired token left `allCourses` at `[]`, and the page rendered:

```jsx
) : ( 'No courses found!!' )
```

An educator with twenty published courses was told they had none, and the only
trace was a `console.log`.

### The endpoint returned everything

```js
const allCourses = await courseSchema.find({ userId: req.body.userId });
if (!allCourses) { ... }
```

- `req.body.userId` is the copy `authMiddleware` writes into the body. #83
  removed exactly that coupling from `/addcourse`; `req.user` is the identity a
  request body cannot influence.
- `find()` resolves to `[]`, which is truthy, so the `!allCourses` branch was
  unreachable dead code — an empty result and a failure were indistinguishable
  to the client.
- No `skip`, no `limit`, no sort, no projection. Every course the teacher owns
  came back as a full document — every section's `S_title`, `S_description` and
  `S_content.path` — to render six scalars and a count.

### The rendering

```jsx
{course.showFullDescription ? course.C_description : course.C_description.slice(0, 10)}
...
<p><strong>Sections: </strong> {course.sections.length}</p>
```

- `slice(0, 10)` is a ten-character preview: *"Learn the "* and then
  *Read More*.
- `course.sections.length` is `undefined` when `sections` is an object map and
  throws `TypeError` when the field is absent. `backend/utils/courseSections.js`
  exists because both shapes are in this collection; the frontend had no
  equivalent, so one legacy document blanked the whole dashboard.
- `<p>` elements sat inside `<Card.Text>`, which React Bootstrap renders as a
  `<p>` — a `validateDOMNesting` warning per card.
- `confirm()` and `alert()` for delete.
- `enrolled` was on every row with no total of it anywhere.

## The fix

### `backend/controllers/teacherCoursesController.js` (new)

`getAllCoursesUserController` moved out of the `userControllers` aggregator and
was rewritten to match every other list endpoint:

```
GET /api/user/getallcoursesteacher?page=&limit=&search=&category=&sort=

{ success, message, data: [...], summary: { courses, learners },
  pagination: { page, limit, totalItems, totalPages,
                hasNextPage, hasPreviousPage } }
```

- The owner is `req.user._id`. `getTeacherId` returns `null` for a request that
  only has `body.userId`, and the controller answers 401 — a test asserts this.
- `normalizePagination` / `buildPaginationMetadata` from `utils/pagination.js`,
  so the envelope is the one the rest of the API returns and `CatalogPager`
  already understands.
- `buildTeacherCourseFilter` runs `search` through `escapeRegex` before it
  reaches a `RegExp` — an unescaped `(` is enough to throw — and always pins
  `userId` to the authenticated educator, so a `userId` in the query string
  changes nothing.
- `buildTeacherCourseSort` is a closed set (`newest`, `oldest`, `title`,
  `enrolled`) with `_id` as a stable tiebreak.
- `toCourseSummary` computes `sectionCount` through `countSections`, which
  handles all three shapes, and **drops `sections` from the response** — the
  table needs the count, not the file paths.
- `summarizeTeacherCourses` is one `$group` aggregation for the totals across
  every course the educator owns, not just the page on screen.

### Frontend

`frontend/src/lib/teacherCourses.js` normalises the response and formats it.
`previewDescription` truncates at 160 characters **on a word boundary** rather
than at 10 mid-word, and `readCourse` gives every field a usable default, so a
malformed row renders a blank cell rather than throwing inside a `.map()`. It
never touches `sections`.

`frontend/src/hooks/useTeacherCourses.js` owns the request: a debounced search,
a request-version guard so a slow page-one response cannot overwrite a fast
page-two one, `clampPage` for when deleting the last course on a page leaves
the client asking for a page that no longer exists, and a silent skip on 401
because the axios interceptor already handles that.

`TeacherHome.jsx`:

- distinct loading, error, empty and no-results-for-this-search states;
- a search box and a sort select reusing the catalogue's classes;
- a totals line — *3 published courses · 40 learners*;
- `CatalogPager` and a range line;
- section counts read from `sectionCount`, so an object-shaped or missing
  `sections` field is a number rather than a blank or a crash;
- `<Card.Text as="div">`, which clears the DOM-nesting warnings;
- an in-page confirmation dialog instead of `confirm()`, and `Toast` instead of
  `alert()`;
- `read-more-link` is a `<button>` instead of a `<span>` with an `onClick`, so
  it is focusable and reachable from a keyboard.

## Tests

`backend/tests/teacher-courses.test.js` — 18 tests:

- the owner comes from `req.user`, and a request carrying only `body.userId` is
  a 401;
- the query is pinned to the authenticated educator even when the query string
  says otherwise;
- **array, object-map and absent `sections` all produce a count**;
- the response carries no section list and no file paths;
- missing scalars get defaults, a non-numeric `enrolled` reads as 0;
- the pagination envelope, `skip`/`limit` arithmetic, a capped absurd limit, a
  garbage page falling back to the first;
- `search` escaped before compiling to a `RegExp`, an empty search adding no
  clause, the category filter anchored;
- sorts a closed set with a stable tiebreak;
- totals across every course, zeroes for an educator with none;
- a database failure is a 500 with a message — the state the old dead
  `if (!allCourses)` branch could never reach.

`frontend/src/lib/teacherCourses.test.js` — 17 tests, including that a long
description is cut on a word boundary and is comfortably longer than the old
ten characters.

Backend: 252 passing (234 before). Frontend: 90 passing (73 before).

## Verifying by hand

1. Sign in as `teacher@learnhub.com`.
2. Stop the backend and reload → *Your courses could not be loaded*, with the
   reason and a **Try again** button. On `main` this reads `No courses found!!`.
3. Restart it. `db.courses.updateOne({C_title: "Modern JavaScript (ES6+)"}, {$set: {sections: {"0": {S_title: "x"}}}})`
   → the card reads *1 section*. On `main` the line is blank.
4. `db.courses.updateOne({C_title: "Modern JavaScript (ES6+)"}, {$unset: {sections: ""}})`
   → the card reads *No sections yet*. On `main` the page is blank and the
   console has a `TypeError`.
5. `curl -H "Authorization: Bearer <TEACHER_TOKEN>" 'localhost:5000/api/user/getallcoursesteacher?page=2&limit=2'`
   → a second page, and `pagination`, and no `sections` in the payload.
6. Search for a title, sort by *Most learners*, and delete a course — the
   confirmation is an in-page dialog and the result is a toast.
