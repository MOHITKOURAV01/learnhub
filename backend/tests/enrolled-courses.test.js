const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  buildProgressSummary,
  countCompletedSections,
  createGetEnrolledCoursesController,
  getRequestingUserId,
} = require("../controllers/enrolledCoursesController");

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

function createRequest({ userId, query = {} } = {}) {
  return {
    user: { _id: userId || new mongoose.Types.ObjectId() },
    query,
    body: {},
  };
}

// A chainable query stub that mirrors the Mongoose builder used by the
// controller: find().sort().skip().limit().lean()
function createQuery(result, calls, label) {
  const query = {
    sort(value) {
      calls.push({ label, stage: "sort", value });
      return query;
    },
    skip(value) {
      calls.push({ label, stage: "skip", value });
      return query;
    },
    limit(value) {
      calls.push({ label, stage: "limit", value });
      return query;
    },
    lean() {
      return Promise.resolve(result);
    },
  };

  return query;
}

function createModels({ enrollments = [], courses = [], totalItems } = {}) {
  const calls = {
    enrollmentFind: [],
    enrollmentStages: [],
    courseFind: [],
  };

  return {
    calls,
    deps: {
      logger: { error() {}, warn() {} },
      EnrolledCourse: {
        find(filter) {
          calls.enrollmentFind.push(filter);
          return createQuery(enrollments, calls.enrollmentStages, "enrollment");
        },
        async countDocuments() {
          return totalItems === undefined ? enrollments.length : totalItems;
        },
      },
      Course: {
        find(filter) {
          calls.courseFind.push(filter);
          return {
            lean: () => Promise.resolve(courses),
          };
        },
      },
    },
  };
}

function makeEnrollment({
  courseId,
  courseLength = 4,
  progress = [],
  createdAt = new Date("2026-01-01T00:00:00Z"),
} = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    courseId: courseId || new mongoose.Types.ObjectId(),
    course_Length: courseLength,
    progress,
    createdAt,
  };
}

function makeCourse(id, title = "A course") {
  return { _id: id, C_title: title, C_educator: "Someone" };
}

test("counts distinct completed sections", () => {
  assert.equal(countCompletedSections([{ sectionId: 0 }, { sectionId: 1 }]), 2);
});

test("ignores duplicate and empty progress entries", () => {
  const progress = [
    { sectionId: 0 },
    { sectionId: 0 },
    { sectionId: "0" },
    { sectionId: null },
    null,
    {},
  ];

  assert.equal(countCompletedSections(progress), 1);
  assert.equal(countCompletedSections(undefined), 0);
  assert.equal(countCompletedSections("not an array"), 0);
});

test("builds a progress summary with a percentage", () => {
  const summary = buildProgressSummary({
    course_Length: 4,
    progress: [{ sectionId: 0 }, { sectionId: 1 }],
  });

  assert.deepEqual(summary, { completed: 2, total: 4, percent: 50 });
});

test("never reports more than 100 percent", () => {
  const summary = buildProgressSummary({
    course_Length: 2,
    progress: [{ sectionId: 0 }, { sectionId: 1 }, { sectionId: 2 }],
  });

  assert.deepEqual(summary, { completed: 2, total: 2, percent: 100 });
});

test("handles a course with no sections without dividing by zero", () => {
  const summary = buildProgressSummary({ course_Length: 0, progress: [] });

  assert.deepEqual(summary, { completed: 0, total: 0, percent: 0 });
});

test("prefers the authenticated user over the request body", () => {
  const authenticated = new mongoose.Types.ObjectId();

  assert.equal(
    getRequestingUserId({ user: { _id: authenticated }, body: { userId: "spoofed" } }),
    authenticated.toString(),
  );
  assert.equal(getRequestingUserId({ body: { userId: "legacy" } }), "legacy");
  assert.equal(getRequestingUserId({ body: {} }), null);
});

test("rejects an unauthenticated request", async () => {
  const { deps } = createModels();
  const controller = createGetEnrolledCoursesController(deps);
  const res = createResponse();

  await controller({ body: {}, query: {} }, res);

  assert.equal(res.statusCode, 401);
});

test("uses one course query for the whole page instead of one per enrolment", async () => {
  const courseIds = Array.from({ length: 20 }, () => new mongoose.Types.ObjectId());
  const { calls, deps } = createModels({
    enrollments: courseIds.map((courseId) => makeEnrollment({ courseId })),
    courses: courseIds.map((courseId) => makeCourse(courseId)),
  });
  const controller = createGetEnrolledCoursesController(deps);
  const res = createResponse();

  await controller(createRequest({ query: { limit: "20" } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.length, 20);
  // Twenty enrolments, still a single course query.
  assert.equal(calls.courseFind.length, 1);
  assert.deepEqual(calls.courseFind[0], { _id: { $in: courseIds } });
});

test("drops enrolments whose course was deleted instead of returning null", async () => {
  const liveId = new mongoose.Types.ObjectId();
  const deletedId = new mongoose.Types.ObjectId();

  const { deps } = createModels({
    enrollments: [
      makeEnrollment({ courseId: liveId }),
      makeEnrollment({ courseId: deletedId }),
    ],
    // The deleted course is simply absent from the lookup.
    courses: [makeCourse(liveId, "Still here")],
  });
  const controller = createGetEnrolledCoursesController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].C_title, "Still here");
  assert.equal(
    res.body.data.some((entry) => entry === null),
    false,
  );
});

test("returns an empty list without querying courses", async () => {
  const { calls, deps } = createModels({ enrollments: [] });
  const controller = createGetEnrolledCoursesController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, []);
  assert.equal(calls.courseFind.length, 0);
});

test("scopes the query to the authenticated user", async () => {
  const userId = new mongoose.Types.ObjectId();
  const { calls, deps } = createModels({ enrollments: [] });
  const controller = createGetEnrolledCoursesController(deps);

  await controller(createRequest({ userId }), createResponse());

  assert.deepEqual(calls.enrollmentFind[0], { userId: userId.toString() });
});

test("orders by newest enrolment first", async () => {
  const { calls, deps } = createModels({ enrollments: [] });
  const controller = createGetEnrolledCoursesController(deps);

  await controller(createRequest(), createResponse());

  const sortStage = calls.enrollmentStages.find((stage) => stage.stage === "sort");
  assert.deepEqual(sortStage.value, { createdAt: -1 });
});

test("applies pagination and returns the shared metadata shape", async () => {
  const courseId = new mongoose.Types.ObjectId();
  const { calls, deps } = createModels({
    enrollments: [makeEnrollment({ courseId })],
    courses: [makeCourse(courseId)],
    totalItems: 30,
  });
  const controller = createGetEnrolledCoursesController(deps);
  const res = createResponse();

  await controller(createRequest({ query: { page: "2", limit: "10" } }), res);

  const skip = calls.enrollmentStages.find((stage) => stage.stage === "skip");
  const limit = calls.enrollmentStages.find((stage) => stage.stage === "limit");

  assert.equal(skip.value, 10);
  assert.equal(limit.value, 10);
  assert.deepEqual(res.body.pagination, {
    page: 2,
    limit: 10,
    totalItems: 30,
    totalPages: 3,
    hasNextPage: true,
    hasPreviousPage: true,
  });
});

test("falls back to the default page size for a junk limit", async () => {
  const { calls, deps } = createModels({ enrollments: [] });
  const controller = createGetEnrolledCoursesController(deps);

  await controller(createRequest({ query: { limit: "not-a-number" } }), createResponse());

  const limit = calls.enrollmentStages.find((stage) => stage.stage === "limit");
  assert.equal(limit.value, 12);
});

test("carries the enrolment context alongside the course", async () => {
  const courseId = new mongoose.Types.ObjectId();
  const enrolledAt = new Date("2026-02-03T10:00:00Z");
  const enrollment = makeEnrollment({
    courseId,
    courseLength: 4,
    progress: [{ sectionId: 0 }, { sectionId: 1 }, { sectionId: 2 }],
    createdAt: enrolledAt,
  });

  const { deps } = createModels({
    enrollments: [enrollment],
    courses: [makeCourse(courseId, "Node basics")],
  });
  const controller = createGetEnrolledCoursesController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  const entry = res.body.data[0];

  assert.equal(entry.C_title, "Node basics");
  assert.equal(entry.enrollmentId, enrollment._id);
  assert.equal(entry.enrolledAt, enrolledAt);
  assert.equal(entry.courseLength, 4);
  assert.equal(entry.certificateDate, null);
  assert.deepEqual(entry.progress, { completed: 3, total: 4, percent: 75 });
});

test("answers 500 with a safe message when a query fails", async () => {
  const controller = createGetEnrolledCoursesController({
    logger: { error() {}, warn() {} },
    EnrolledCourse: {
      find() {
        throw new Error("connection reset by peer");
      },
      async countDocuments() {
        return 0;
      },
    },
    Course: { find: () => ({ lean: async () => [] }) },
  });
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "Failed to fetch enrolled courses");
});
