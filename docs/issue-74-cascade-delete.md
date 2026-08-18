# Issue 74 — deletion that actually deletes

Both admin delete endpoints were one line of work:

```js
const course = await courseSchema.findByIdAndDelete(courseid);
const user = await userSchema.findByIdAndDelete(userid);
```

Nothing else. Every row pointing at the deleted document survived it, and every
`.mp4` belonging to a deleted course stayed in `backend/uploads` forever.

The teacher route already did this properly — `courseDeletionController` calls
`removeCourseVideoFiles`, and it has always accepted an admin
(`["teacher", "admin"].includes(role)`). But `adminRoutes.js` pointed
`DELETE /api/admin/deletecourse/:courseid` at a second, weaker copy in
`adminController.js`, so the same action cleaned up or did not depending on
which screen triggered it.

## What the orphans did

- `GET /api/admin/enrolled-courses` and `/api/admin/payments` `.populate()`
  rows whose target is gone, and the dashboard renders a blank student or a
  blank course title.
- `getSummary()` in `courseReviewController` keeps averaging reviews written by
  accounts that no longer exist, for courses nobody can open.
- `getEnrolledCoursesController` has a defensive skip for enrolments whose
  course is missing, added in #65 — needed only because deletion left them.
- `course.enrolled` only ever went up. Deleting a learner left the count where
  it was, so the number on the catalogue card drifts upward permanently.
- Payment history for deleted users stayed fully readable in the admin
  dashboard.

## What changed

### `utils/cascadeDelete.js` (new)

Both entry points go through here, so they cannot diverge again.

`removeCourseDependents(courseId, { course })` — deletes the enrolments,
payments, reviews and bookmarks that reference the course, and removes its
section videos when the deleted document is handed in.

`removeUserDependents(userId)` — the same for a user, plus:

- Courses they authored are deleted, each through `removeCourseDependents`, so
  a teacher's learners lose the enrolment rather than keeping a row pointing at
  nothing.
- Their own enrolments are read *before* deletion, grouped by course, and each
  affected course's `enrolled` count is decremented.

Two details worth knowing about:

**`courseModel.userId` is a `String`** while every other reference is an
`ObjectId`. Passing the ObjectId straight into `Course.find({ userId })`
matches nothing, silently leaving the teacher's courses behind. The cascade
converts explicitly, and there is a test that would fail if that were removed.

**The learner count is decremented, not recounted.** `enrolled` has already
drifted on existing data, and a recount would quietly rewrite numbers the admin
has been looking at. The `$inc: -1` is guarded by `enrolled: { $gt: 0 }`, which
is what stops it going negative when the counter is lower than reality.

### `routers/adminRoutes.js`

`DELETE /api/admin/deletecourse/:courseid` now points at
`courseDeletionController`, the same one the teacher route uses. The weaker
duplicate in `adminController.js` is gone.

### `controllers/courseDeletionController.js`

Calls the cascade after the delete, and reports what went with it:

```json
{
  "success": true,
  "message": "Course deleted successfully",
  "cleanup": { "deletedFiles": 3, "failedFiles": 0 },
  "removed": { "enrolments": 12, "payments": 12, "reviews": 4, "bookmarks": 7 }
}
```

The cascade is injectable (`cascade`), like `cleanupFiles` already was, so the
ownership tests stay unit tests.

### `controllers/adminController.js`

`deleteUserController` calls `removeUserDependents` and returns the summary.

## Checking it

```bash
# Before: the video and the rows survive. After: they do not.
curl -X DELETE localhost:5000/api/admin/deletecourse/$COURSE_ID -H "Authorization: Bearer $ADMIN"
ls backend/uploads
mongosh --eval 'db.enrolledcourses.countDocuments({ courseId: ObjectId("...") })'
mongosh --eval 'db.coursereviews.countDocuments({ courseId: ObjectId("...") })'
```

## What this does not do

Existing orphans are left alone. This stops new ones; a sweep for rows already
pointing at nothing is a separate job, and deleting historical payment records
is a decision for a maintainer rather than a side effect of a bug fix.

## Tests

`tests/cascade-delete.test.js`, 10 cases against in-memory collections: that
another course's rows are untouched, that section videos are removed, that a
file which cannot be deleted is reported rather than thrown, per-course
grouping, the decrement including the below-zero guard, a student delete, a
teacher delete that takes their courses with it, the String/ObjectId mismatch,
and the empty case.

`tests/course-ownership.test.js` gained a cascade stub in the controllers it
builds; the ownership assertions are unchanged.
