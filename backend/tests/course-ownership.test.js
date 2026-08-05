const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createDeleteCourseController,
} = require("../controllers/courseDeletionController");

function createResponse() {
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

function createCourse(overrides = {}) {
  return {
    _id: "64b7f1e2c3d4e5f607182930",
    userId: "teacher-1",
    sections: [],
    ...overrides,
  };
}

function createCourseModel(course, deletedCourse = course) {
  const calls = {
    findById: [],
    findOneAndDelete: [],
  };

  return {
    calls,
    async findById(id) {
      calls.findById.push(id);
      return course;
    },
    async findOneAndDelete(filter) {
      calls.findOneAndDelete.push(filter);
      return deletedCourse;
    },
  };
}

const validId = "64b7f1e2c3d4e5f607182930";
const isValidObjectId = (value) => value === validId;

test("teacher can delete their own course", async () => {
  const Course = createCourseModel(createCourse());
  const cleanupCalls = [];
  const controller = createDeleteCourseController({
    Course,
    isValidObjectId,
    cleanupFiles: async (course) => {
      cleanupCalls.push(course);
      return { deleted: ["video.mp4"], failed: [] };
    },
  });
  const req = {
    params: { courseid: validId },
    body: { userId: "attacker-controlled-value" },
    user: { _id: "teacher-1", role: "teacher" },
  };
  const res = createResponse();

  await controller(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(Course.calls.findOneAndDelete[0], {
    _id: validId,
    userId: "teacher-1",
  });
  assert.equal(cleanupCalls.length, 1);
});

test("teacher cannot delete another teacher's course", async () => {
  const Course = createCourseModel(createCourse({ userId: "teacher-2" }));
  const controller = createDeleteCourseController({
    Course,
    isValidObjectId,
    cleanupFiles: async () => ({ deleted: [], failed: [] }),
  });
  const req = {
    params: { courseid: validId },
    user: { _id: "teacher-1", role: "teacher" },
  };
  const res = createResponse();

  await controller(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /only delete courses you own/i);
  assert.equal(Course.calls.findOneAndDelete.length, 0);
});

test("admin can delete any course", async () => {
  const Course = createCourseModel(createCourse({ userId: "teacher-2" }));
  const controller = createDeleteCourseController({
    Course,
    isValidObjectId,
    cleanupFiles: async () => ({ deleted: [], failed: [] }),
  });
  const req = {
    params: { courseid: validId },
    user: { _id: "admin", role: "admin" },
  };
  const res = createResponse();

  await controller(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(Course.calls.findOneAndDelete[0], { _id: validId });
});

test("ownership comes from authenticated identity, not request body", async () => {
  const Course = createCourseModel(createCourse({ userId: "teacher-2" }));
  const controller = createDeleteCourseController({
    Course,
    isValidObjectId,
    cleanupFiles: async () => ({ deleted: [], failed: [] }),
  });
  const req = {
    params: { courseid: validId },
    body: { userId: "teacher-2" },
    user: { _id: "teacher-1", role: "teacher" },
  };
  const res = createResponse();

  await controller(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(Course.calls.findOneAndDelete.length, 0);
});

test("invalid course ID returns 400 without querying MongoDB", async () => {
  const Course = createCourseModel(createCourse());
  const controller = createDeleteCourseController({
    Course,
    isValidObjectId,
    cleanupFiles: async () => ({ deleted: [], failed: [] }),
  });
  const req = {
    params: { courseid: "bad-id" },
    user: { _id: "teacher-1", role: "teacher" },
  };
  const res = createResponse();

  await controller(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(Course.calls.findById.length, 0);
});

test("missing course returns 404", async () => {
  const Course = createCourseModel(null, null);
  const controller = createDeleteCourseController({
    Course,
    isValidObjectId,
    cleanupFiles: async () => ({ deleted: [], failed: [] }),
  });
  const req = {
    params: { courseid: validId },
    user: { _id: "teacher-1", role: "teacher" },
  };
  const res = createResponse();

  await controller(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(Course.calls.findOneAndDelete.length, 0);
});

test("file cleanup failures do not restore or expose deleted course", async () => {
  const Course = createCourseModel(createCourse());
  const warnings = [];
  const controller = createDeleteCourseController({
    Course,
    isValidObjectId,
    cleanupFiles: async () => ({
      deleted: [],
      failed: [{ filename: "video.mp4", reason: "locked" }],
    }),
    logger: {
      warn(message, details) {
        warnings.push({ message, details });
      },
      error() {},
    },
  });
  const req = {
    params: { courseid: validId },
    user: { _id: "teacher-1", role: "teacher" },
  };
  const res = createResponse();

  await controller(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cleanup.failedFiles, 1);
  assert.equal(warnings.length, 1);
});
