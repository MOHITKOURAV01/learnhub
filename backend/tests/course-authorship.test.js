const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const request = require("supertest");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

const {
  normalizeCoursePrice,
  resolveAuthor,
  validateCourseSubmission,
} = require("../utils/courseInput");
const {
  createPostCourseController,
} = require("../controllers/courseCreationController");
const {
  createPreserveAuthIdentity,
} = require("../middlewares/preserveAuthIdentity");
const { createCourseVideoUpload } = require("../utils/videoUpload");
const {
  createCourseVideoUploadMiddleware,
} = require("../utils/courseVideoUploadMiddleware");

// POST /api/user/addcourse read `userId` and `C_educator` out of the multipart
// form. Multer starts a multipart parse with `req.body = Object.create(null)`,
// so the id authMiddleware had written there was gone and the form's value
// took its place: a teacher could publish a course owned by, and credited to,
// somebody else.
//
// The unit tests below pin the resolution rules; the integration tests drive a
// real multipart upload through the real middleware chain, because the bug only
// exists once Multer is in it.

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

const teacher = {
  _id: "64b7f1e2c3d4e5f607182930",
  name: "Jane Educator",
  type: "teacher",
};

function submission(overrides = {}) {
  return {
    body: {
      C_title: "Intro to Testing",
      C_categories: "Engineering",
      C_description: "A short course.",
      C_price: "0",
      S_title: "Section one",
      S_description: "Opening section",
      ...(overrides.body || {}),
    },
    files: overrides.files || [{ filename: "one.mp4" }],
    user: "user" in overrides ? overrides.user : teacher,
  };
}

// -- identity ----------------------------------------------------------------

test("the author comes from req.user, not from the body", () => {
  const result = validateCourseSubmission(
    submission({ body: { userId: "somebody-else", C_educator: "Impostor" } }),
  );

  assert.equal(result.valid, true);
  assert.equal(result.value.userId, teacher._id);
  assert.equal(result.value.C_educator, teacher.name);
});

test("an ObjectId-shaped id is stored as a string", () => {
  const author = resolveAuthor({
    _id: { toString: () => "64b7f1e2c3d4e5f607182930" },
    name: "Jane",
  });

  assert.equal(author.userId, "64b7f1e2c3d4e5f607182930");
  assert.equal(typeof author.userId, "string");
});

test("a request with no authenticated user is rejected as unauthenticated", () => {
  const result = validateCourseSubmission(submission({ user: undefined }));

  assert.equal(result.valid, false);
  assert.equal(result.unauthenticated, true);
});

test("the admin pseudo-identity has no name, so it may name the educator", () => {
  const result = validateCourseSubmission(
    submission({
      user: { _id: "admin", type: "admin" },
      body: { C_educator: "Guest Lecturer" },
    }),
  );

  assert.equal(result.valid, true);
  assert.equal(result.value.userId, "admin");
  assert.equal(result.value.C_educator, "Guest Lecturer");
});

test("the admin pseudo-identity without an educator is a 400, not a 500", () => {
  const result = validateCourseSubmission(
    submission({ user: { _id: "admin" }, body: { C_educator: "" } }),
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.C_educator, /required/i);
});

// -- content validation ------------------------------------------------------

test("a missing title is a validation error rather than a save failure", () => {
  const result = validateCourseSubmission(
    submission({ body: { C_title: "   " } }),
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.C_title, /required/i);
});

test("a course with no section video is rejected", () => {
  const result = validateCourseSubmission(submission({ files: [] }));

  assert.equal(result.valid, false);
  assert.match(result.errors.S_content, /at least one/i);
});

test("a repeated scalar field cannot smuggle an array into the document", () => {
  const result = validateCourseSubmission(
    submission({ body: { C_title: ["First", "Second"] } }),
  );

  assert.equal(result.valid, true);
  assert.equal(result.value.C_title, "First");
});

test("sections pair each file with the field at the same index", () => {
  const result = validateCourseSubmission(
    submission({
      files: [{ filename: "a.mp4" }, { filename: "b.mp4" }],
      body: {
        S_title: ["One", "Two"],
        S_description: ["First", "Second"],
      },
    }),
  );

  assert.deepEqual(result.value.sections, [
    {
      S_title: "One",
      S_content: { filename: "a.mp4", path: "/uploads/a.mp4" },
      S_description: "First",
    },
    {
      S_title: "Two",
      S_content: { filename: "b.mp4", path: "/uploads/b.mp4" },
      S_description: "Second",
    },
  ]);
});

test("free prices are stored the way the catalogue filter matches them", () => {
  assert.equal(normalizeCoursePrice("0"), "free");
  assert.equal(normalizeCoursePrice("0.00"), "free");
  assert.equal(normalizeCoursePrice(" Free "), "free");
  assert.equal(normalizeCoursePrice(""), "free");
  assert.equal(normalizeCoursePrice(undefined), "free");
  assert.equal(normalizeCoursePrice("499"), "499");
});

// -- controller --------------------------------------------------------------

test("a rejected submission deletes the videos it already accepted", async () => {
  const cleaned = [];
  const controller = createPostCourseController({
    Course: class {
      async save() {
        throw new Error("should not be reached");
      }
    },
    cleanupFiles: async (files) => {
      cleaned.push(files);
      return { deleted: files.map((file) => file.filename), failed: [] };
    },
    logger: { error() {}, warn() {} },
  });

  const req = {
    files: [{ filename: "orphan.mp4" }],
    body: { C_title: "", C_categories: "", C_description: "" },
    user: teacher,
  };
  const res = response();

  await controller(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(cleaned.length, 1);
  assert.deepEqual(cleaned[0], req.files);
});

test("the saved document carries the authenticated author", async () => {
  const saved = [];

  class RecordingCourse {
    constructor(fields) {
      Object.assign(this, fields);
      this._id = "generated-id";
    }

    async save() {
      saved.push({ ...this });
    }
  }

  const controller = createPostCourseController({
    Course: RecordingCourse,
    cleanupFiles: async () => ({ deleted: [], failed: [] }),
    logger: { error() {}, warn() {} },
  });

  const req = {
    files: [{ filename: "one.mp4" }],
    body: {
      userId: "forged",
      C_educator: "Forged Educator",
      C_title: "Real course",
      C_categories: "Engineering",
      C_description: "Real description",
      C_price: "0",
    },
    user: teacher,
    };
  const res = response();

  await controller(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].userId, teacher._id);
  assert.equal(saved[0].C_educator, teacher.name);
  assert.equal(saved[0].C_price, "free");
});

// -- preserveAuthIdentity ----------------------------------------------------

test("preserveAuthIdentity puts the token id back after a multipart parse", () => {
  const middleware = createPreserveAuthIdentity();
  // Multer's body has a null prototype; assignment has to survive that.
  const req = { body: Object.assign(Object.create(null), { userId: "forged" }), user: teacher };
  let called = false;

  middleware(req, {}, () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(req.body.userId, teacher._id);
});

test("preserveAuthIdentity strips a client userId when nobody is authenticated", () => {
  const middleware = createPreserveAuthIdentity();
  const req = { body: { userId: "forged" } };

  middleware(req, {}, () => {});

  assert.equal("userId" in req.body, false);
});

// -- through the real route --------------------------------------------------

let app;
let Course;
let User;
let uploadsDirectory;

// The route is assembled here the way userRoutes assembles it, but pointed at a
// temporary uploads directory so the suite does not write into backend/uploads.
function buildCourseApp() {
  const instance = express();
  const authMiddleware = require("../middlewares/authMiddleware");
  const checkRole = require("../middlewares/roleMiddleware");
  const { cleanupUploadedFiles } = require("../utils/uploadCleanup");

  const upload = createCourseVideoUpload({
    multerLib: multer,
    uploadsDirectory,
  });

  // cleanupUploadedFiles resolves filenames against backend/uploads. The suite
  // uploads into a temporary directory instead, so it is pointed at that one.
  const postCourseController = createPostCourseController({
    cleanupFiles: (files) => cleanupUploadedFiles(files, { uploadsDirectory }),
    logger: { error() {}, warn() {} },
  });

  instance.use(express.json());
  instance.post(
    "/api/user/addcourse",
    authMiddleware,
    checkRole(["teacher", "admin"]),
    createCourseVideoUploadMiddleware({ upload }),
    createPreserveAuthIdentity(),
    postCourseController,
  );

  return instance;
}

test.before(async () => {
  await startTestDatabase();
  uploadsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "learnhub-uploads-"));
  app = buildCourseApp();
  Course = require("../schemas/courseModel");
  User = require("../schemas/userModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
  fs.rmSync(uploadsDirectory, { recursive: true, force: true });
});

async function createTeacher(name, email) {
  return User.create({
    name,
    email,
    password: "hashed-password",
    type: "teacher",
    isVerified: true,
  });
}

function tokenFor(user) {
  return jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

// A tiny well-formed MP4 header is enough: the filter checks the extension and
// the declared MIME type, not the container's contents.
const MP4_BYTES = Buffer.from("00000018667479706d703432", "hex");

function postCourse(token, fields = {}) {
  const pending = request(app)
    .post("/api/user/addcourse")
    .set("Authorization", `Bearer ${token}`)
    .field("C_title", "Forged course")
    .field("C_categories", "Engineering")
    .field("C_description", "Body-supplied ownership")
    .field("C_price", "0")
    .field("S_title", "Section one")
    .field("S_description", "Opening");

  for (const [key, value] of Object.entries(fields)) {
    pending.field(key, value);
  }

  return pending.attach("S_content", MP4_BYTES, {
    filename: "lesson.mp4",
    contentType: "video/mp4",
  });
}

test("a teacher cannot publish a course owned by another teacher", async () => {
  const author = await createTeacher("Jane Educator", "jane@learnhub.test");
  const victim = await createTeacher("Sam Victim", "sam@learnhub.test");

  const res = await postCourse(tokenFor(author), {
    userId: String(victim._id),
    C_educator: "Sam Victim",
  });

  assert.equal(res.status, 201);

  const stored = await Course.findOne({ C_title: "Forged course" }).lean();

  assert.equal(stored.userId, String(author._id));
  assert.equal(stored.C_educator, "Jane Educator");

  assert.equal(await Course.countDocuments({ userId: String(victim._id) }), 0);
});

test("a course posted with no userId at all still saves", async () => {
  const author = await createTeacher("Jane Educator", "jane@learnhub.test");

  const res = await postCourse(tokenFor(author));

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);

  const stored = await Course.findOne({ C_title: "Forged course" }).lean();
  assert.equal(stored.userId, String(author._id));
});

test("a submission missing a required field answers 400, not 500", async () => {
  const author = await createTeacher("Jane Educator", "jane@learnhub.test");

  const res = await request(app)
    .post("/api/user/addcourse")
    .set("Authorization", `Bearer ${tokenFor(author)}`)
    .field("C_categories", "Engineering")
    .field("C_description", "No title")
    .attach("S_content", MP4_BYTES, {
      filename: "lesson.mp4",
      contentType: "video/mp4",
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /title/i);
  assert.equal(await Course.countDocuments({}), 0);
});

test("a rejected submission does not leave its upload on disk", async () => {
  const author = await createTeacher("Jane Educator", "jane@learnhub.test");

  const before = fs.readdirSync(uploadsDirectory).length;

  await request(app)
    .post("/api/user/addcourse")
    .set("Authorization", `Bearer ${tokenFor(author)}`)
    .field("C_categories", "Engineering")
    .field("C_description", "No title")
    .attach("S_content", MP4_BYTES, {
      filename: "lesson.mp4",
      contentType: "video/mp4",
    });

  assert.equal(fs.readdirSync(uploadsDirectory).length, before);
});
