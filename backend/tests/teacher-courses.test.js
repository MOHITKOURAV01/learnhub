const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  buildTeacherCourseFilter,
  buildTeacherCourseSort,
  createGetTeacherCoursesController,
  getTeacherId,
  toCourseSummary,
} = require("../controllers/teacherCoursesController");

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

const TEACHER_ID = new mongoose.Types.ObjectId().toString();

/**
 * A chainable stand-in for the Mongoose query builder, recording what the
 * controller asked for.
 */
function createCourseModel({ courses = [], totalItems, summary } = {}) {
  const calls = { find: [], select: [], sort: [], skip: [], limit: [], count: [], aggregate: [] };

  const query = {
    select(fields) {
      calls.select.push(fields);
      return query;
    },
    sort(value) {
      calls.sort.push(value);
      return query;
    },
    skip(value) {
      calls.skip.push(value);
      return query;
    },
    limit(value) {
      calls.limit.push(value);
      return query;
    },
    async lean() {
      return courses;
    },
  };

  return {
    calls,
    find(filter) {
      calls.find.push(filter);
      return query;
    },
    async countDocuments(filter) {
      calls.count.push(filter);
      return totalItems === undefined ? courses.length : totalItems;
    },
    async aggregate(pipeline) {
      calls.aggregate.push(pipeline);
      return summary ? [summary] : [];
    },
  };
}

function createRequest({ query = {}, user = { _id: TEACHER_ID } } = {}) {
  return { query, user, body: {} };
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

test("the owner comes from req.user, never from the request body", () => {
  assert.equal(getTeacherId({ user: { _id: TEACHER_ID } }), TEACHER_ID);
  assert.equal(getTeacherId({ user: { id: TEACHER_ID } }), TEACHER_ID);
  // The old controller filtered on exactly this value.
  assert.equal(getTeacherId({ body: { userId: "someone-else" } }), null);
  assert.equal(getTeacherId({}), null);
});

test("an unauthenticated request is a 401, not an empty list", async () => {
  const controller = createGetTeacherCoursesController({
    Course: createCourseModel(),
  });
  const res = createResponse();

  await controller(createRequest({ user: null }), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("the query is always scoped to the authenticated educator", async () => {
  const model = createCourseModel();
  const controller = createGetTeacherCoursesController({ Course: model });

  await controller(
    createRequest({ query: { userId: "someone-else" } }),
    createResponse(),
  );

  assert.equal(model.calls.find[0].userId, TEACHER_ID);
  assert.equal(model.calls.count[0].userId, TEACHER_ID);
});

/* ------------------------------------------------------------------ *
 * Section counting — the shape that blanked the dashboard
 * ------------------------------------------------------------------ */

test("sections stored as an array, an object map or nothing all count", () => {
  assert.equal(toCourseSummary({ sections: [{}, {}, {}] }).sectionCount, 3);
  // `sections.length` in the browser was `undefined` for this one.
  assert.equal(
    toCourseSummary({ sections: { 0: {}, 1: {} } }).sectionCount,
    2,
  );
  // And a TypeError for this one, which took the whole page down.
  assert.equal(toCourseSummary({}).sectionCount, 0);
  assert.equal(toCourseSummary({ sections: null }).sectionCount, 0);
});

test("the summary carries no section list, only the count", () => {
  const summary = toCourseSummary({
    _id: "abc",
    C_title: "Intro",
    sections: [{ S_content: { path: "/uploads/secret.mp4" } }],
  });

  assert.equal(summary.sectionCount, 1);
  assert.equal(summary.sections, undefined);
  assert.equal(JSON.stringify(summary).includes("secret.mp4"), false);
});

test("missing scalar fields get usable defaults rather than undefined", () => {
  const summary = toCourseSummary({});

  assert.equal(summary.C_title, "Untitled course");
  assert.equal(summary.C_description, "");
  assert.equal(summary.C_price, "free");
  assert.equal(summary.enrolled, 0);
});

test("a non-numeric enrolled count does not leak into the response", () => {
  assert.equal(toCourseSummary({ enrolled: "many" }).enrolled, 0);
  assert.equal(toCourseSummary({ enrolled: 7 }).enrolled, 7);
});

/* ------------------------------------------------------------------ *
 * Pagination, search, sort
 * ------------------------------------------------------------------ */

test("the response carries the project's pagination envelope", async () => {
  const controller = createGetTeacherCoursesController({
    Course: createCourseModel({
      courses: [{ _id: "a", C_title: "One", sections: [] }],
      totalItems: 30,
      summary: { courses: 30, learners: 412 },
    }),
  });
  const res = createResponse();

  await controller(createRequest({ query: { page: "2", limit: "10" } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.pagination, {
    page: 2,
    limit: 10,
    totalItems: 30,
    totalPages: 3,
    hasNextPage: true,
    hasPreviousPage: true,
  });
});

test("page and limit reach the query as skip and limit", async () => {
  const model = createCourseModel({ totalItems: 100 });
  const controller = createGetTeacherCoursesController({ Course: model });

  await controller(createRequest({ query: { page: "3", limit: "5" } }), createResponse());

  assert.deepEqual(model.calls.skip, [10]);
  assert.deepEqual(model.calls.limit, [5]);
});

test("an absurd limit is capped rather than honoured", async () => {
  const model = createCourseModel();
  const controller = createGetTeacherCoursesController({ Course: model });

  await controller(createRequest({ query: { limit: "100000" } }), createResponse());

  assert.equal(model.calls.limit[0], 100);
});

test("a garbage page falls back to the first one", async () => {
  const model = createCourseModel();
  const controller = createGetTeacherCoursesController({ Course: model });

  await controller(
    createRequest({ query: { page: "-4", limit: "abc" } }),
    createResponse(),
  );

  assert.deepEqual(model.calls.skip, [0]);
  assert.equal(model.calls.limit[0], 12);
});

test("search is escaped before it reaches a RegExp", () => {
  const filter = buildTeacherCourseFilter(TEACHER_ID, { search: "C++ (basics)" });

  assert.equal(filter.userId, TEACHER_ID);
  assert.equal(filter.$or.length, 2);
  // Unescaped, this string throws when compiled.
  assert.doesNotThrow(() => new RegExp(filter.$or[0].C_title.$regex));
  assert.equal(filter.$or[0].C_title.$regex.test("c++ (basics) for all"), true);
});

test("an empty search adds no clause at all", () => {
  assert.deepEqual(buildTeacherCourseFilter(TEACHER_ID, { search: "   " }), {
    userId: TEACHER_ID,
  });
  assert.deepEqual(buildTeacherCourseFilter(TEACHER_ID, {}), {
    userId: TEACHER_ID,
  });
});

test("the category filter matches the whole value, case-insensitively", () => {
  const filter = buildTeacherCourseFilter(TEACHER_ID, {
    category: "it & software",
  });

  assert.equal(filter.C_categories.$regex.test("IT & Software"), true);
  assert.equal(filter.C_categories.$regex.test("IT & Software Extra"), false);
});

test("sorts are a closed set with a stable tiebreak", () => {
  assert.deepEqual(buildTeacherCourseSort({ sort: "title" }), {
    C_title: 1,
    _id: 1,
  });
  assert.deepEqual(buildTeacherCourseSort({ sort: "enrolled" }), {
    enrolled: -1,
    _id: 1,
  });
  assert.deepEqual(buildTeacherCourseSort({ sort: "oldest" }), {
    createdAt: 1,
    _id: 1,
  });
  assert.deepEqual(buildTeacherCourseSort({ sort: "'; drop" }), {
    createdAt: -1,
    _id: -1,
  });
});

/* ------------------------------------------------------------------ *
 * Totals
 * ------------------------------------------------------------------ */

test("the totals cover every course, not just the page on screen", async () => {
  const controller = createGetTeacherCoursesController({
    Course: createCourseModel({
      courses: [{ _id: "a", enrolled: 3, sections: [] }],
      totalItems: 40,
      summary: { courses: 40, learners: 987 },
    }),
  });
  const res = createResponse();

  await controller(createRequest(), res);

  assert.deepEqual(res.body.summary, { courses: 40, learners: 987 });
});

test("an educator with no courses gets zeroed totals, not undefined", async () => {
  const controller = createGetTeacherCoursesController({
    Course: createCourseModel({ courses: [], totalItems: 0 }),
  });
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, []);
  assert.deepEqual(res.body.summary, { courses: 0, learners: 0 });
  assert.equal(res.body.pagination.totalPages, 0);
});

/* ------------------------------------------------------------------ *
 * Failure
 * ------------------------------------------------------------------ */

test("a database failure is a 500 with a message, not a silent empty list", async () => {
  const controller = createGetTeacherCoursesController({
    Course: {
      find() {
        throw new Error("connection reset");
      },
      async countDocuments() {
        return 0;
      },
      async aggregate() {
        return [];
      },
    },
    logger: { error() {} },
  });
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Failed to fetch courses");
  // The old controller could not reach this state: `if (!allCourses)` was dead
  // code because find() resolves to [], so an empty list and a failure were
  // indistinguishable to the client.
  assert.equal(res.body.data, undefined);
});
