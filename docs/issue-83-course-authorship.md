# Issue 83 — who owns a new course

`POST /api/user/addcourse` decided the owner of a course by reading `userId`
out of the multipart form.

`authMiddleware` publishes the caller two ways:

```js
req.body.userId = decode.id;   // for the older controllers
req.user = user;               // for everything since
```

and the route ran Multer between that middleware and the controller. The first
thing Multer does with a multipart request is throw the body away:

```js
// multer/lib/make-middleware.js:23
req.body = Object.create(null)
```

so the id written by the middleware was gone, the form's fields took its place,
and `courseCreationController` destructured the result:

```js
const { userId, C_educator, ... } = req.body;
const course = new CourseModel({ userId, C_educator, ... });
```

`AddCourse.jsx` posted the signed-in user's own `_id`, which is why the app
looked correct. Nothing on the server checked that it matched the token.

## What it allowed

- Any teacher could post `userId=<another teacher's id>` and publish a course
  owned by that person. It appeared on their Teacher Home and counted against
  them.
- The forger could not then delete their own upload — `deleteCourseController`
  compares `course.userId` against the token — so the victim was the only
  account able to remove it.
- `C_educator` was free text, so a course could be credited to a well-known
  educator who had nothing to do with it.
- Deleting the victim's account cascaded away a course they never wrote, videos
  included, because `removeUserDependents` matches on `Course.userId`.
- Omitting `userId` entirely produced a `ValidationError` and a `500`, for what
  is a client mistake.

## What changed

### `utils/courseInput.js` (new)

The submission rules, with no Express and no Mongoose in them so they can be
tested directly:

- `resolveAuthor(user)` reads `_id`/`id` and `name` off `req.user` and returns
  them as strings. `req.user` is set by the same middleware and Multer does not
  touch it.
- `validateCourseSubmission({ body, files, user })` returns either the exact
  document to save or a field-keyed error object. `userId` and `C_educator` are
  taken from the author, never from the body — a form that still posts them is
  ignored rather than rejected, so an older client keeps working.
- `firstValue()` collapses a repeated multipart field, so `C_title=a&C_title=b`
  cannot reach Mongoose as an array.
- `normalizeCoursePrice()` replaces `C_price == 0 ? "free" : C_price`. It reuses
  the catalogue's own `FREE_PRICE_PATTERN`, so `"0"`, `"0.00"`, `"Free"` and
  `""` all store as `"free"` and the free/paid filter agrees with what was
  written.
- At least one section video is now required. Without that check a course saved
  with `sections: []`, and enrolling in it stored `course_Length: 0`, which
  renders as 100% complete on first load.

The one caller allowed to name the educator is the admin pseudo-identity
(`req.user = { _id: "admin" }`), which has no `name`. Every real account has
one, so for every real account the field is derived.

### `controllers/courseCreationController.js`

Validates first, and answers `401` for a missing identity and `400` with a
readable message for a bad submission, instead of letting Mongoose throw into
the `500` branch. A rejected submission deletes the videos Multer has already
written — they are on disk before the controller runs. The success response now
carries the new course's id.

### `middlewares/preserveAuthIdentity.js` (new)

The controller reads `req.user` and does not need this. It is mounted directly
after the upload anyway, so the *next* multipart route added to this project
cannot inherit the same trap: after it, `req.body.userId` is the token's id
again, and it is deleted outright when there is no authenticated caller —
removing a client-supplied value matters as much as writing the real one.

### `AddCourse.jsx`

- Stops posting `userId`, and shows the educator as a read-only field filled
  from the signed-in account.
- Only appends `S_title`/`S_description` for sections that actually carry a
  file. The server pairs sections with files by position, so a section without
  a video used to shift every later section onto the wrong one.
- Shows the server's message on a rejected submission rather than always
  claiming the file must have been the wrong type, and drops the `console.log`
  of every form field.

## Tests

`backend/tests/course-authorship.test.js`, 18 tests. The unit half covers the
resolution rules; the integration half drives a real multipart upload through
`authMiddleware → checkRole → Multer → preserveAuthIdentity → controller`,
because the bug only exists once Multer is in the chain:

- a teacher posting another teacher's id gets a course owned by themselves,
  and the victim's course count stays at zero
- a post with no `userId` field at all still saves
- a missing title answers `400` and writes nothing
- a rejected submission leaves no file in the uploads directory

`video-upload.test.js` gained a `req.user` in its one course-creation case; the
assertion it makes is unchanged.
