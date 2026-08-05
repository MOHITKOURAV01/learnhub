const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  createCompleteSectionController,
  normalizeSectionId,
} = require("../controllers/progressController");

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

function createModels({
  course = { sections: [{ S_title: "One" }, { S_title: "Two" }] },
  enrollment = { _id: new mongoose.Types.ObjectId() },
  modifiedCount = 1,
} = {}) {
  const calls = { updateOne: [] };

  return {
    calls,
    CourseModel: {
      async findById() {
        return course;
      },
    },
    EnrolledCourseModel: {
      async findOne() {
        return enrollment;
      },
      async updateOne(filter, update) {
        calls.updateOne.push({ filter, update });
        return { matchedCount: modifiedCount, modifiedCount };
      },
    },
  };
}

function createRequest(courseId, sectionId) {
  return {
    body: { courseId, sectionId },
    user: { _id: new mongoose.Types.ObjectId() },
  };
}

test("normalizes the current numeric section index contract", () => {
  assert.equal(normalizeSectionId([{}, {}], "1"), 1);
  assert.equal(normalizeSectionId([{}, {}], 2), null);
});

test("accepts a valid section and performs one atomic add", async () => {
  const courseId = new mongoose.Types.ObjectId().toString();
  const models = createModels();
  const controller = createCompleteSectionController(models);
  const res = createResponse();

  await controller(createRequest(courseId, 1), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.alreadyCompleted, false);
  assert.equal(models.calls.updateOne.length, 1);
  assert.deepEqual(models.calls.updateOne[0].filter["progress.sectionId"], {
    $ne: 1,
  });
  assert.deepEqual(models.calls.updateOne[0].update, {
    $addToSet: { progress: { sectionId: 1 } },
  });
});

test("returns a clear idempotent response for an existing completion", async () => {
  const courseId = new mongoose.Types.ObjectId().toString();
  const models = createModels({ modifiedCount: 0 });
  const controller = createCompleteSectionController(models);
  const res = createResponse();

  await controller(createRequest(courseId, 0), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.alreadyCompleted, true);
});

test("rejects a section that does not belong to the course", async () => {
  const courseId = new mongoose.Types.ObjectId().toString();
  const models = createModels();
  const controller = createCompleteSectionController(models);
  const res = createResponse();

  await controller(createRequest(courseId, 9), res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Section not found in this course");
  assert.equal(models.calls.updateOne.length, 0);
});

test("rejects an unenrolled student", async () => {
  const courseId = new mongoose.Types.ObjectId().toString();
  const models = createModels({ enrollment: null });
  const controller = createCompleteSectionController(models);
  const res = createResponse();

  await controller(createRequest(courseId, 0), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, "User is not enrolled in this course");
  assert.equal(models.calls.updateOne.length, 0);
});

test("returns 404 when the course does not exist", async () => {
  const courseId = new mongoose.Types.ObjectId().toString();
  const models = createModels({ course: null });
  const controller = createCompleteSectionController(models);
  const res = createResponse();

  await controller(createRequest(courseId, 0), res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Course not found");
});

test("rejects malformed course IDs before querying models", async () => {
  const models = createModels();
  const controller = createCompleteSectionController(models);
  const res = createResponse();

  await controller(createRequest("not-an-object-id", 0), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid courseId");
  assert.equal(models.calls.updateOne.length, 0);
});
