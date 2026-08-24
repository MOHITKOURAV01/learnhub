# Issue #62 — Enrolment integrity

## What was wrong

`enrolledCourseController` in `backend/controllers/userControllers.js` handled
`POST /api/user/enrolledcourse/:courseid`. Three independent defects lived in it.

### 1. `sections` was assumed to be an array

`courseModel` declares `sections: {}`, which Mongoose stores as a Mixed value.
Documents therefore hold arrays, object maps, or nothing. The controller read
`course.sections.length` directly, so an object-shaped or missing `sections`
produced `undefined`, and `course_Length` is a required `Number`. The save
failed validation and the endpoint answered `500 Failed to enroll in the course`.

### 2. The duplicate check keyed on `course_Length`

```js
const enrolledCourse = await enrolledCourseSchema.findOne({
  courseId: courseid,
  userId: userId,
  course_Length: course_Length,
});
```

Adding or removing a section changed `course_Length`, the lookup stopped
matching the existing row, and the controller tried to insert a second
enrolment. `enrolledCourseModel` carries a unique index on
`{ userId, courseId }`, so Mongo answered E11000 and the student saw a 500
instead of "you are already enrolled".

### 3. The counter was a read-modify-write

`course.enrolled += 1; await course.save();` reads, mutates and writes in three
steps. Two concurrent enrolments both read the same value and both write
`n + 1`, so the tally drifts below the real number of students. The payment row
was also written *before* the enrolment was confirmed, leaving orphan rows
behind when the enrolment then failed.

A malformed `:courseid` was passed straight to Mongoose and came back as a 500
CastError rather than a 400.

## What changed

The handler moved to `backend/controllers/enrollmentController.js`, following
the module shape already used by `courseDeletionController` and
`progressController`: a `createEnrollCourseController({ ... })` factory that
takes injectable models plus a thin default export bound to the real schemas.

| Behaviour | Before | After |
| --- | --- | --- |
| Object-shaped `sections` | 500 | enrols, `course_Length` counted correctly |
| Missing `sections` | 500 | enrols with `course_Length: 0` |
| Corrupt `sections` (string/number) | 500 | 422 with a clear message |
| Malformed course id | 500 CastError | 400 `Invalid course ID` |
| Second enrolment | 200 `success: false` | 200 `alreadyEnrolled: true` |
| Second enrolment after a section was added | 500 E11000 | 200 `alreadyEnrolled: true`, stored length refreshed |
| Concurrent enrolments | counter drifts | `$inc`, exactly one increment |
| Failed enrolment | orphan payment row | no payment row |
| User identity | `req.body.userId` | `req.user._id` from the auth middleware |

`backend/utils/courseSections.js` holds the shared normalisation:
`normalizeSections`, `countSections` and `hasReadableSections`. It handles
arrays, plain objects, `Map` instances and `null`/`undefined`.

## Files

- `backend/controllers/enrollmentController.js` — new controller
- `backend/utils/courseSections.js` — shared `sections` normalisation
- `backend/controllers/userControllers.js` — legacy handler removed
- `backend/routers/userRoutes.js` — route points at the new controller
- `backend/tests/enrollment.test.js` — unit tests

## Testing

```bash
cd backend
node --test tests/enrollment.test.js
```

The tests inject fake models, so no database is required. They cover every row
of the table above, including the E11000 race and the "no payment row on
failure" guarantee.
