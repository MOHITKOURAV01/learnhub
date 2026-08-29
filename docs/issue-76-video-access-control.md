# Issue 76 — course videos were downloadable without an account

Two things combined into a complete bypass of enrolment and payment.

**`app.js` served the upload directory to the world:**

```js
app.use("/uploads", express.static(uploadsDir));
```

No auth, no enrolment check.

**And the public catalogue published the filenames.** `GET
/api/user/getallcourses` has no `authMiddleware` on it — a visitor is meant to
browse — and `courseListingController` returned whole course documents with
`.lean()`. `sections` is part of that document, and every section carries
`S_content.path`.

So one anonymous request listed the storage path of every video in the system,
and a second downloaded it:

```bash
curl -s 'http://localhost:5000/api/user/getallcourses?limit=100' \
  | python3 -c 'import json,sys; [print(s["S_content"]["path"]) for c in json.load(sys.stdin)["data"] for s in (c.get("sections") or []) if s.get("S_content")]'

curl -O 'http://localhost:5000/uploads/S_content-1742555168462-781033667.mp4'
```

Fixing only the listing would not have been enough. The directory would still
have been readable by anyone who had ever legitimately seen a path — a student
who enrolled once and then unenrolled, or anyone they sent the URL to.

## What changed

### The catalogue stops publishing paths — `utils/publicCourse.js` (new)

`toPublicCourse()` drops `sections` and adds `sectionCount`. A catalogue card
renders nothing from inside a section, and a visitor deciding whether to enrol
is better served by "12 lessons" than by a list of filenames.

`sections` is declared as `{}` on the schema, so it holds whatever was written
to it. Only an array is counted; anything else reads as zero rather than
throwing.

### `/uploads` is no longer served

`app.js` no longer mounts `express.static` on it. Section videos come from a
route that checks who is asking.

### `GET /api/user/coursevideo/:courseid/:sectionIndex` (new)

`controllers/courseVideoController.js`. Three things it has to get right:

**Authentication without a header.** `ReactPlayer` sets the `src` of a
`<video>` element, and that request cannot carry an `Authorization` header. The
route therefore takes its credential from the query string — but not the
session token. URLs land in browser history, in `Referer` headers, and in every
access log between the client and the server, and the session token is good for
a day against every endpoint in the app.

`utils/playbackTokens.js` mints a separate one: 30 minutes, one course, scope
`course-video`. It is issued by `/api/user/coursecontent/:courseid`, which is
the only place that has already confirmed the caller is enrolled.

The scope check in `verifyPlaybackToken` is the load-bearing line. Both tokens
are signed with `JWT_SECRET`, so without it any session token would satisfy
this route for every course — which is most of what the fix was for. There is a
test that fails if that check is removed.

**Path confinement.** `S_content.path` is data an upload handler wrote, not a
constant. It goes through `resolveSafeUploadPath` (already in the tree from
#40), which takes the basename and confines the result to the uploads
directory, so a `..` that ever reached the database cannot turn this route into
an arbitrary file read.

**Range requests.** `express.static` handled these for free. Reading the whole
file and sending it back breaks seeking: a `<video>` element scrubs by asking
for a byte range, and a player also reads the MP4 index with a suffix range
(`bytes=-200`) before it can start. `utils/rangeRequests.js` parses the header
and the controller answers 206 with `Content-Range`, or 416 for a range past
the end of the file.

Responses carry `Cache-Control: private, no-store`, since the URL that produced
them contains a credential.

### The client

`/coursecontent` now returns each section with a `streamUrl` instead of a
storage path, plus the playback token. `CourseContent.jsx` no longer builds a
path into `/uploads`; `resolveCourseVideoUrl` in `AxiosInstance.jsx` attaches
the token.

## Verifying

```bash
# The catalogue no longer contains a single file path.
curl -s 'localhost:5000/api/user/getallcourses' | grep -c 'S_content' # 0

# The directory is not served.
curl -sI localhost:5000/uploads/intro.mp4 | head -1   # 404

# The stream route without a token.
curl -sI 'localhost:5000/api/user/coursevideo/<id>/0' | head -1  # 401

# With a session token in place of a playback token.
curl -sI "localhost:5000/api/user/coursevideo/<id>/0?token=$SESSION" | head -1  # 401

# As an enrolled student: /coursecontent returns playbackToken, and
curl -sI "localhost:5000/api/user/coursevideo/<id>/0?token=$PLAYBACK" | head -1  # 200
curl -sI -H 'Range: bytes=200-399' "...?token=$PLAYBACK" | head -1               # 206
```

## Notes for reviewers

- Existing courses keep working. Rows written before the upload handler stored
  a `filename` only have `path`; `sectionFilename()` reads either and both end
  up as a basename.
- `seed.js` writes `/uploads/intro.mp4` and friends for files that do not
  exist. Those sections now 404 from the stream route instead of 404ing from
  the static handler — the same outcome, from a different place.
- The admin course listing is untouched. It is behind `requireAdmin`, and the
  admin dashboard is the one place a full document is legitimate.

## Tests

`tests/course-video-access.test.js`, 22 cases: that no path survives anywhere
in a catalogue payload, non-array `sections`, the token's scope/course/expiry
including a session token being refused and one signed with a different secret,
the route with no token and with a token for another course, a successful
stream and its headers, a `resolvePath` that refuses (traversal), a missing
file on disk, an index off the end, 206 for a range and 416 past the end, and
range-header parsing for all four forms a player sends.
