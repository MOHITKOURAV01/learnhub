# Issue #65 — Enrolled courses: N+1 queries and null rows

## What was wrong

`sendAllCoursesUserController` backed `GET /api/user/getallcoursesuser`, the
student "My courses" list:

```js
const enrolledCourses = await enrolledCourseSchema.find({ userId });

const coursesDetails = await Promise.all(
  enrolledCourses.map(async (enrolledCourse) => {
    const courseDetails = await courseSchema.findOne({
      _id: enrolledCourse.courseId,
    });
    return courseDetails;            // null once the course is deleted
  })
);
```

**One query per enrolment.** A student with 40 enrolments caused 41 queries on
every page load, even though `courseId` is already an `ObjectId` reference and a
single `$in` returns the same data.

**Null rows.** Nothing filtered the results. `courseDeletionController` removes
a course without touching enrolment rows, so a deleted course left a `null` in
the array. `EnrolledCourses.jsx` maps over `res.data.data` and reads
`course.C_title`, so one deleted course blanked the whole screen for every
student enrolled in it with `Cannot read properties of null`.

**No pagination, no progress.** The full enrolment history came back unbounded,
and although the enrolment row already stores `progress` and `course_Length`,
none of it was sent, so the client had no way to draw a completion bar.

## What changed

The handler moved to `backend/controllers/enrolledCoursesController.js` with the
injectable-model shape used by `courseListingController` and
`progressController`.

- **Two queries, always.** The enrolment page is fetched with
  `sort/skip/limit`, then every course on that page is loaded with one
  `find({ _id: { $in: ids } })` and matched through a `Map`. Twenty enrolments,
  one course query — asserted in the tests.
- **Deleted courses are dropped**, not returned as `null`.
- **Pagination** reuses `utils/pagination.js`, so the response carries the same
  `pagination` block that `GET /api/user/getallcourses` already returns.
- **Stable ordering**: newest enrolment first, instead of natural collection
  order.
- **Progress summary** per entry: `{ completed, total, percent }`. Completed
  sections are counted as a `Set`, because `progress` is append-only and older
  rows can hold the same `sectionId` twice; `completed` is capped at `total` so
  a stale duplicate cannot report 120%.
- **Identity** comes from `req.user` first, falling back to `req.body.userId`
  so nothing that relied on the old behaviour breaks.

## Response shape

The existing fields are untouched, so `EnrolledCourses.jsx` keeps working with
no change:

```json
{
  "success": true,
  "data": [
    {
      "_id": "...", "C_title": "...", "C_educator": "...", "C_categories": "...",
      "enrollmentId": "...",
      "enrolledAt": "2026-02-03T10:00:00.000Z",
      "courseLength": 4,
      "certificateDate": null,
      "progress": { "completed": 3, "total": 4, "percent": 75 }
    }
  ],
  "pagination": {
    "page": 1, "limit": 12, "totalItems": 30, "totalPages": 3,
    "hasNextPage": true, "hasPreviousPage": false
  }
}
```

The failure response also changed from `{ error: "An error occurred" }` to the
project's `{ success: false, message }` envelope, which is what every client
here checks.

## Files

- `backend/controllers/enrolledCoursesController.js` — new controller
- `backend/controllers/userControllers.js` — legacy handler removed
- `backend/routers/userRoutes.js` — route points at the new controller
- `backend/tests/enrolled-courses.test.js` — unit tests

## Testing

```bash
cd backend
node --test tests/enrolled-courses.test.js
```

Sixteen tests with injected models, no database needed. They assert the single
course query for a twenty-enrolment page, the deleted-course filtering, the
empty-list short circuit, the sort order, the pagination metadata, the duplicate
and over-100% progress edge cases, and the 500 path.
