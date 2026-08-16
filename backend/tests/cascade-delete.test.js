const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decrementEnrolledCounts,
  groupByCourse,
  removeCourseDependents,
  removeUserDependents,
} = require("../utils/cascadeDelete");

/**
 * A stand-in collection: rows in memory, plus the filters it was asked to
 * delete on, so a test can assert on the query and not only the count.
 */
function createCollection(rows = []) {
  const collection = {
    rows: [...rows],
    deleteFilters: [],
    updates: [],
    // Mirrors the Mongoose builder: find() is chainable, lean() awaits.
    find(filter) {
      return {
        lean: async () => collection.rows.filter((row) => matches(row, filter)),
      };
    },
    async deleteMany(filter) {
      collection.deleteFilters.push(filter);

      const before = collection.rows.length;
      collection.rows = collection.rows.filter((row) => !matches(row, filter));

      return { deletedCount: before - collection.rows.length };
    },
    async deleteOne(filter) {
      const index = collection.rows.findIndex((row) => matches(row, filter));

      if (index === -1) return { deletedCount: 0 };

      collection.rows.splice(index, 1);
      return { deletedCount: 1 };
    },
    async updateOne(filter, update) {
      collection.updates.push({ filter, update });

      const row = collection.rows.find((candidate) => matches(candidate, filter));

      if (!row) return { modifiedCount: 0 };

      const inc = update.$inc || {};
      for (const [field, delta] of Object.entries(inc)) {
        row[field] = (row[field] || 0) + delta;
      }

      return { modifiedCount: 1 };
    },
  };

  return collection;
}

function matches(row, filter = {}) {
  return Object.entries(filter).every(([field, expected]) => {
    const actual = row[field];

    if (expected && typeof expected === "object" && "$gt" in expected) {
      return Number(actual) > expected.$gt;
    }

    return String(actual) === String(expected);
  });
}

function createModels({ courses = [], enrolments = [], payments = [], reviews = [], bookmarks = [], logs = [] } = {}) {
  return {
    Course: createCollection(courses),
    EnrolledCourse: createCollection(enrolments),
    CoursePayment: createCollection(payments),
    CourseReview: createCollection(reviews),
    CourseBookmark: createCollection(bookmarks),
    ActivityLog: createCollection(logs),
  };
}

const noFiles = async () => ({ deleted: [], failed: [] });

// -- deleting a course -------------------------------------------------------

test("deleting a course clears every row that referenced it", async () => {
  const models = createModels({
    enrolments: [
      { _id: "e1", courseId: "c1", userId: "u1" },
      { _id: "e2", courseId: "c1", userId: "u2" },
      { _id: "e3", courseId: "c2", userId: "u1" },
    ],
    payments: [
      { _id: "p1", courseId: "c1", userId: "u1" },
      { _id: "p2", courseId: "c2", userId: "u1" },
    ],
    reviews: [{ _id: "r1", courseId: "c1", userId: "u1" }],
    bookmarks: [
      { _id: "b1", courseId: "c1", userId: "u3" },
      { _id: "b2", courseId: "c2", userId: "u3" },
    ],
  });

  const result = await removeCourseDependents("c1", {
    models,
    cleanupFiles: noFiles,
  });

  assert.deepEqual(
    { ...result, files: undefined },
    {
      enrolments: 2,
      payments: 1,
      reviews: 1,
      bookmarks: 1,
      files: undefined,
    },
  );

  // Another course's rows are untouched.
  assert.deepEqual(
    models.EnrolledCourse.rows.map((row) => row._id),
    ["e3"],
  );
  assert.deepEqual(
    models.CourseBookmark.rows.map((row) => row._id),
    ["b2"],
  );
});

test("deleting a course removes its section videos", async () => {
  const models = createModels();
  const course = {
    _id: "c1",
    sections: [{ S_content: { filename: "one.mp4" } }],
  };

  const cleaned = [];
  const result = await removeCourseDependents("c1", {
    models,
    course,
    cleanupFiles: async (input) => {
      cleaned.push(input);
      return { deleted: ["one.mp4"], failed: [] };
    },
  });

  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0], course);
  assert.equal(result.files.deleted, 1);
  assert.equal(result.files.failed, 0);
});

test("a file that cannot be removed is reported, not thrown", async () => {
  const models = createModels();

  const result = await removeCourseDependents("c1", {
    models,
    course: { _id: "c1", sections: [] },
    cleanupFiles: async () => ({
      deleted: [],
      failed: [{ filename: "locked.mp4", reason: "EBUSY" }],
    }),
  });

  assert.equal(result.files.failed, 1);
});

// -- learner counts ----------------------------------------------------------

test("enrolments are counted per course", () => {
  const counts = groupByCourse([
    { courseId: "c1" },
    { courseId: "c2" },
    { courseId: "c1" },
    { courseId: null },
    {},
  ]);

  assert.equal(counts.get("c1"), 2);
  assert.equal(counts.get("c2"), 1);
  assert.equal(counts.size, 2);
});

test("the learner count drops by one per removed enrolment", async () => {
  const Course = createCollection([
    { _id: "c1", enrolled: 5 },
    { _id: "c2", enrolled: 1 },
  ]);

  await decrementEnrolledCounts(
    new Map([
      ["c1", 2],
      ["c2", 1],
    ]),
    Course,
  );

  assert.equal(Course.rows.find((row) => row._id === "c1").enrolled, 3);
  assert.equal(Course.rows.find((row) => row._id === "c2").enrolled, 0);
});

test("the learner count cannot be driven below zero", async () => {
  // `enrolled` has drifted on existing data — it was only ever incremented —
  // so a course can hold fewer enrolments than its counter claims.
  const Course = createCollection([{ _id: "c1", enrolled: 1 }]);

  await decrementEnrolledCounts(new Map([["c1", 4]]), Course);

  assert.equal(Course.rows[0].enrolled, 0);
});

// -- deleting a user ---------------------------------------------------------

test("deleting a student clears their rows and corrects the learner counts", async () => {
  const models = createModels({
    courses: [
      { _id: "c1", userId: "teacher-1", enrolled: 3 },
      { _id: "c2", userId: "teacher-1", enrolled: 1 },
    ],
    enrolments: [
      { _id: "e1", courseId: "c1", userId: "student-1" },
      { _id: "e2", courseId: "c2", userId: "student-1" },
      { _id: "e3", courseId: "c1", userId: "student-2" },
    ],
    payments: [{ _id: "p1", courseId: "c1", userId: "student-1" }],
    reviews: [{ _id: "r1", courseId: "c1", userId: "student-1" }],
    bookmarks: [{ _id: "b1", courseId: "c1", userId: "student-1" }],
    logs: [
      { _id: "l1", userId: "student-1" },
      { _id: "l2", userId: "student-2" },
    ],
  });

  const summary = await removeUserDependents("student-1", {
    models,
    cleanupFiles: noFiles,
  });

  assert.equal(summary.authoredCourses, 0);
  assert.equal(summary.enrolments, 2);
  assert.equal(summary.payments, 1);
  assert.equal(summary.reviews, 1);
  assert.equal(summary.bookmarks, 1);
  assert.equal(summary.activityLogs, 1);

  // The other student keeps theirs.
  assert.deepEqual(
    models.EnrolledCourse.rows.map((row) => row._id),
    ["e3"],
  );
  assert.deepEqual(
    models.ActivityLog.rows.map((row) => row._id),
    ["l2"],
  );

  // Both courses lose the one learner that went away.
  assert.equal(models.Course.rows.find((row) => row._id === "c1").enrolled, 2);
  assert.equal(models.Course.rows.find((row) => row._id === "c2").enrolled, 0);
});

test("deleting a teacher takes their courses, and those courses' rows, with them", async () => {
  const models = createModels({
    courses: [
      { _id: "c1", userId: "teacher-1", enrolled: 2, sections: [] },
      { _id: "c9", userId: "teacher-2", enrolled: 1, sections: [] },
    ],
    enrolments: [
      { _id: "e1", courseId: "c1", userId: "student-1" },
      { _id: "e2", courseId: "c1", userId: "student-2" },
      { _id: "e9", courseId: "c9", userId: "student-1" },
    ],
    payments: [{ _id: "p1", courseId: "c1", userId: "student-1" }],
    reviews: [{ _id: "r1", courseId: "c1", userId: "student-2" }],
    bookmarks: [{ _id: "b1", courseId: "c1", userId: "student-3" }],
  });

  const cleaned = [];
  const summary = await removeUserDependents("teacher-1", {
    models,
    cleanupFiles: async (course) => {
      cleaned.push(course._id);
      return { deleted: ["a.mp4"], failed: [] };
    },
  });

  assert.equal(summary.authoredCourses, 1);
  assert.equal(summary.enrolments, 2);
  assert.equal(summary.reviews, 1);
  assert.equal(summary.bookmarks, 1);
  assert.equal(summary.files.deleted, 1);

  assert.deepEqual(cleaned, ["c1"], "only the authored course is cleaned up");

  // Another teacher's course and its enrolment survive.
  assert.deepEqual(
    models.Course.rows.map((row) => row._id),
    ["c9"],
  );
  assert.deepEqual(
    models.EnrolledCourse.rows.map((row) => row._id),
    ["e9"],
  );
});

test("authored courses are matched on the string userId the course schema stores", async () => {
  // courseModel.userId is a String while every other reference is an ObjectId.
  // Passing the ObjectId straight through matches nothing and silently leaves
  // the courses behind.
  const objectIdLike = {
    toString: () => "507f1f77bcf86cd799439011",
  };

  const models = createModels({
    courses: [{ _id: "c1", userId: "507f1f77bcf86cd799439011", enrolled: 0, sections: [] }],
  });

  const summary = await removeUserDependents(objectIdLike, {
    models,
    cleanupFiles: noFiles,
  });

  assert.equal(summary.authoredCourses, 1);
  assert.equal(models.Course.rows.length, 0);
});

test("deleting a user with nothing attached is a no-op that still reports", async () => {
  const models = createModels();

  const summary = await removeUserDependents("nobody", {
    models,
    cleanupFiles: noFiles,
  });

  assert.deepEqual(summary, {
    authoredCourses: 0,
    enrolments: 0,
    payments: 0,
    reviews: 0,
    bookmarks: 0,
    activityLogs: 0,
    files: { deleted: 0, failed: 0 },
  });
});
