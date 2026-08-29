const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const {
  createCourseVideoController,
  sectionFilename,
  selectSection,
} = require("../controllers/courseVideoController");

const {
  PLAYBACK_TTL_SECONDS,
  signPlaybackToken,
  tokenCoversCourse,
  verifyPlaybackToken,
} = require("../utils/playbackTokens");

const {
  buildRangeResponseHeaders,
  parseRangeHeader,
} = require("../utils/rangeRequests");

const {
  toPublicCourse,
  toPublicCourses,
  withPlaybackUrls,
} = require("../utils/publicCourse");

const SECRET = "learnhub-test-secret";
const COURSE_ID = "64b7f1e2c3d4e5f607182930";
const OTHER_COURSE_ID = "64b7f1e2c3d4e5f607182931";
const USER_ID = "64b7f1c2a1b2c3d4e5f60718";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(headers) {
      Object.assign(this.headers, headers);
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function createCourseModel(course) {
  return {
    findById() {
      return { lean: async () => course };
    },
  };
}

const courseWithVideo = {
  _id: COURSE_ID,
  C_title: "Paid course",
  sections: [
    {
      S_title: "Intro",
      S_content: { filename: "intro.mp4", path: "/uploads/intro.mp4" },
    },
    { S_title: "No video" },
  ],
};

function createController(overrides = {}) {
  const streams = [];

  const controller = createCourseVideoController({
    Course: createCourseModel(courseWithVideo),
    resolvePath: (filename) => `/srv/uploads/${filename}`,
    stat: async () => ({ size: 1000 }),
    createReadStream: (filePath, options) => {
      streams.push({ filePath, options });
      return { pipe: (res) => res };
    },
    verifyToken: (token) => verifyPlaybackToken(token, SECRET),
    logger: { warn() {}, error() {} },
    ...overrides,
  });

  return { controller, streams };
}

const request = (token, sectionIndex = "0", headers = {}) => ({
  params: { courseid: COURSE_ID, sectionIndex },
  query: { token },
  headers,
});

// -- the leak that made this reachable ---------------------------------------

test("the public catalogue no longer carries section file paths", () => {
  const listed = toPublicCourse({
    _id: COURSE_ID,
    C_title: "Paid course",
    sections: [
      { S_content: { path: "/uploads/intro.mp4", filename: "intro.mp4" } },
      { S_content: { path: "/uploads/two.mp4", filename: "two.mp4" } },
    ],
  });

  assert.equal(listed.sections, undefined);
  assert.equal(listed.sectionCount, 2);
  assert.equal(listed.C_title, "Paid course");

  // The whole payload, not just the sections key: a path must not survive
  // anywhere in the response.
  assert.ok(!JSON.stringify(listed).includes("intro.mp4"));
});

test("a course whose sections are not an array reports zero rather than throwing", () => {
  // courseModel declares `sections: {}`, so the field holds whatever was
  // written to it.
  assert.equal(toPublicCourse({ sections: { a: 1 } }).sectionCount, 0);
  assert.equal(toPublicCourse({}).sectionCount, 0);
  assert.deepEqual(toPublicCourses(null), []);
  assert.equal(toPublicCourses([{ sections: [] }])[0].sectionCount, 0);
});

test("an enrolled viewer gets a stream URL, never a storage path", () => {
  const sections = withPlaybackUrls(courseWithVideo.sections, COURSE_ID);

  assert.equal(
    sections[0].S_content.streamUrl,
    `/api/user/coursevideo/${COURSE_ID}/0`,
  );
  assert.equal(sections[0].S_content.filename, undefined);
  assert.equal(sections[0].S_content.path, undefined);
  assert.equal(sections[0].S_title, "Intro");

  // A section with no upload stays in the list so the indexes still line up
  // with what the stream route expects.
  assert.equal(sections[1].S_content, null);
});

// -- the token ---------------------------------------------------------------

test("a playback token is scoped to one viewer, one course, and reading video", () => {
  const token = signPlaybackToken(
    { userId: USER_ID, courseId: COURSE_ID },
    SECRET,
  );

  const claims = verifyPlaybackToken(token, SECRET);

  assert.equal(claims.userId, USER_ID);
  assert.equal(claims.courseId, COURSE_ID);
  assert.equal(tokenCoversCourse(claims, COURSE_ID), true);
  assert.equal(tokenCoversCourse(claims, OTHER_COURSE_ID), false);
});

test("a session token is not a playback token", () => {
  // Both are signed with JWT_SECRET. Without the scope check, a day-long
  // session token would open the video route for every course.
  const sessionToken = jwt.sign({ id: USER_ID }, SECRET, { expiresIn: "1d" });

  assert.equal(verifyPlaybackToken(sessionToken, SECRET), null);
});

test("a token signed with a different secret is rejected", () => {
  const forged = signPlaybackToken(
    { userId: USER_ID, courseId: COURSE_ID },
    "some-other-secret",
  );

  assert.equal(verifyPlaybackToken(forged, SECRET), null);
});

test("an expired token is rejected", () => {
  const expired = jwt.sign(
    { sub: USER_ID, courseId: COURSE_ID, scope: "course-video" },
    SECRET,
    { expiresIn: -60 },
  );

  assert.equal(verifyPlaybackToken(expired, SECRET), null);
});

test("the token expires in well under the session's lifetime", () => {
  assert.ok(PLAYBACK_TTL_SECONDS < 24 * 60 * 60);
  assert.equal(PLAYBACK_TTL_SECONDS, 30 * 60);
});

test("garbage in place of a token is rejected without throwing", () => {
  for (const value of [undefined, null, "", "not.a.token", 42, {}]) {
    assert.equal(verifyPlaybackToken(value, SECRET), null);
  }
});

// -- the route ---------------------------------------------------------------

test("no token means no video", async () => {
  const { controller, streams } = createController();
  const res = createResponse();

  await controller(request(undefined), res);

  assert.equal(res.statusCode, 401);
  assert.equal(streams.length, 0);
});

test("a token for another course does not open this one", async () => {
  const { controller, streams } = createController();
  const token = signPlaybackToken(
    { userId: USER_ID, courseId: OTHER_COURSE_ID },
    SECRET,
  );

  const res = createResponse();
  await controller(request(token), res);

  assert.equal(res.statusCode, 401);
  assert.equal(streams.length, 0);
});

test("a valid token streams the section video", async () => {
  const { controller, streams } = createController();
  const token = signPlaybackToken({ userId: USER_ID, courseId: COURSE_ID }, SECRET);

  const res = createResponse();
  await controller(request(token), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "video/mp4");
  assert.equal(res.headers["Content-Length"], "1000");
  assert.equal(res.headers["Accept-Ranges"], "bytes");
  // The URL carries a credential, so no shared cache may keep the body.
  assert.equal(res.headers["Cache-Control"], "private, no-store");
  assert.equal(streams.length, 1);
  assert.equal(streams[0].filePath, "/srv/uploads/intro.mp4");
});

test("a path that escapes the uploads directory is refused", async () => {
  // S_content.path is data an upload handler wrote, not a constant. If a
  // traversal ever reached the database this route must not become an
  // arbitrary file read.
  const { controller, streams } = createController({
    resolvePath: () => null,
  });
  const token = signPlaybackToken({ userId: USER_ID, courseId: COURSE_ID }, SECRET);

  const res = createResponse();
  await controller(request(token), res);

  assert.equal(res.statusCode, 404);
  assert.equal(streams.length, 0);
});

test("a section with no upload, and an index off the end, both 404", async () => {
  const token = signPlaybackToken({ userId: USER_ID, courseId: COURSE_ID }, SECRET);

  for (const index of ["1", "9", "-1", "abc", "0.5"]) {
    const { controller, streams } = createController();
    const res = createResponse();

    await controller(request(token, index), res);

    assert.equal(res.statusCode, 404, `index ${index} should 404`);
    assert.equal(streams.length, 0);
  }
});

test("a row whose file has been deleted from disk 404s rather than 500s", async () => {
  const { controller } = createController({
    stat: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  });
  const token = signPlaybackToken({ userId: USER_ID, courseId: COURSE_ID }, SECRET);

  const res = createResponse();
  await controller(request(token), res);

  assert.equal(res.statusCode, 404);
});

test("a range request gets a 206 for exactly the bytes asked for", async () => {
  const { controller, streams } = createController();
  const token = signPlaybackToken({ userId: USER_ID, courseId: COURSE_ID }, SECRET);

  const res = createResponse();
  await controller(request(token, "0", { range: "bytes=200-399" }), res);

  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["Content-Range"], "bytes 200-399/1000");
  assert.equal(res.headers["Content-Length"], "200");
  assert.deepEqual(streams[0].options, { start: 200, end: 399 });
});

test("a range past the end of the file is a 416", async () => {
  const { controller, streams } = createController();
  const token = signPlaybackToken({ userId: USER_ID, courseId: COURSE_ID }, SECRET);

  const res = createResponse();
  await controller(request(token, "0", { range: "bytes=5000-" }), res);

  assert.equal(res.statusCode, 416);
  assert.equal(res.headers["Content-Range"], "bytes */1000");
  assert.equal(streams.length, 0);
});

// -- range parsing ------------------------------------------------------------

test("range headers are read the way a video element sends them", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-499", 1000), { start: 0, end: 499 });
  // Open-ended: from here to the end.
  assert.deepEqual(parseRangeHeader("bytes=500-", 1000), { start: 500, end: 999 });
  // Suffix: the last 200 bytes, which is how a player reads the MP4 index.
  assert.deepEqual(parseRangeHeader("bytes=-200", 1000), { start: 800, end: 999 });
  // An end past the file is clamped, not rejected.
  assert.deepEqual(parseRangeHeader("bytes=900-5000", 1000), { start: 900, end: 999 });
});

test("no range, or one that cannot be honoured, is reported distinctly", () => {
  assert.equal(parseRangeHeader(undefined, 1000), null);
  assert.equal(parseRangeHeader("", 1000), null);
  // Multi-range is not supported; sending the whole file is a valid answer.
  assert.equal(parseRangeHeader("bytes=0-99,200-299", 1000), null);
  assert.equal(parseRangeHeader("items=0-99", 1000), null);

  assert.equal(parseRangeHeader("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=500-100", 1000), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=-0", 1000), "unsatisfiable");
});

test("the 206 headers describe the slice, not the file", () => {
  const headers = buildRangeResponseHeaders({ start: 10, end: 19 }, 1000);

  assert.equal(headers["Content-Length"], "10");
  assert.equal(headers["Content-Range"], "bytes 10-19/1000");
});

// -- section helpers ---------------------------------------------------------

test("only a real index into a real array selects a section", () => {
  const sections = [{ S_title: "a" }, { S_title: "b" }];

  assert.equal(selectSection(sections, "1").S_title, "b");
  assert.equal(selectSection(sections, "2"), null);
  assert.equal(selectSection(sections, "-1"), null);
  assert.equal(selectSection(sections, " 1 ").S_title, "b");
  assert.equal(selectSection({ nope: true }, "0"), null);
  assert.equal(selectSection(null, "0"), null);
});

test("the filename is read from either the new or the old section shape", () => {
  assert.equal(sectionFilename({ S_content: { filename: "a.mp4" } }), "a.mp4");
  // Rows written before the upload handler stored a filename.
  assert.equal(sectionFilename({ S_content: { path: "/uploads/b.mp4" } }), "/uploads/b.mp4");
  assert.equal(sectionFilename({ S_content: {} }), "");
  assert.equal(sectionFilename({}), "");
  assert.equal(sectionFilename(null), "");
});
