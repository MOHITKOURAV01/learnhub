const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  collectModelReferences,
  collectSchemaReferences,
  describeUnresolvedReference,
  findUnresolvedReferences,
  verifyModelReferences,
} = require("../utils/modelReferences");

// #113. `activityLogModel` declared `ref: "User"` and the user model is
// registered as `"user"`. Mongoose resolves a ref by exact name at populate
// time, so the mismatch was not a wrong answer — it was a thrown
// MissingSchemaError, and the admin Activity Logs page answered 500 on every
// request because of it.
//
// The functional fix is one character. These tests are the part that matters:
// nothing in the suite would have caught it, and nothing would catch the next
// one either.

// -- the real schemas --------------------------------------------------------

// Registers every model, the same list config/connect.js requires. Requiring
// them here rather than relying on another test file having done it first
// keeps this file meaningful when run on its own.
require("../schemas/userModel");
require("../schemas/courseModel");
require("../schemas/enrolledCourseModel");
require("../schemas/coursePaymentModel");
require("../schemas/courseBookmarkModel");
require("../schemas/courseReviewModel");
require("../schemas/activityLogModel");
require("../schemas/verificationAttemptModel");

test("every ref in the project names a registered model", () => {
  const unresolved = findUnresolvedReferences(mongoose.models);

  assert.deepEqual(
    unresolved,
    [],
    unresolved
      .map((reference) =>
        describeUnresolvedReference(reference, Object.keys(mongoose.models)),
      )
      .join("\n"),
  );
});

test("the activity log points at the model the user schema registers", () => {
  // The specific regression. Spelled out rather than left to the sweep above,
  // so a failure names the field instead of the whole graph.
  const ActivityLog = mongoose.models.ActivityLog;

  assert.equal(ActivityLog.schema.path("userId").options.ref, "user");
  assert.ok(mongoose.models.user, "the user model is registered as 'user'");
});

test("the sweep actually covers the references it should", () => {
  // A guard that silently collects nothing would pass forever. Assert the
  // known edges are in the graph.
  const references = collectModelReferences(mongoose.models);
  const pairs = references.map((row) => `${row.model}.${row.path} -> ${row.ref}`);

  for (const expected of [
    "ActivityLog.userId -> user",
    "courseReview.userId -> user",
    "courseReview.courseId -> course",
    "courseBookmark.userId -> user",
    "courseBookmark.courseId -> course",
    "coursePayment.userId -> user",
    "coursePayment.courseId -> course",
    "enrolledCourses.userId -> user",
    "enrolledCourses.courseId -> course",
  ]) {
    assert.ok(pairs.includes(expected), `missing edge: ${expected}`);
  }
});

// -- the collector, in isolation ---------------------------------------------

test("a scalar ref is collected", () => {
  const schema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "widget" },
  });

  assert.deepEqual(collectSchemaReferences(schema, "thing"), [
    { model: "thing", path: "owner", ref: "widget" },
  ]);
});

test("a ref on an array element type is collected", () => {
  // `[{ type: ObjectId, ref: "..." }]` puts the options on the caster, not on
  // the path, so reading only `schemaType.options` would miss it entirely.
  const schema = new mongoose.Schema({
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "tag" }],
  });

  assert.deepEqual(collectSchemaReferences(schema, "thing"), [
    { model: "thing", path: "tags", ref: "tag" },
  ]);
});

test("a refPath is not reported, because it cannot be resolved statically", () => {
  // refPath names the *field* holding the model name, so the target is only
  // known per document. Reporting it would be a false positive on every run.
  const schema = new mongoose.Schema({
    targetType: String,
    target: { type: mongoose.Schema.Types.ObjectId, refPath: "targetType" },
  });

  assert.deepEqual(collectSchemaReferences(schema, "thing"), []);
});

test("a schema with no references collects nothing, and a missing schema is not an error", () => {
  const schema = new mongoose.Schema({ name: String });

  assert.deepEqual(collectSchemaReferences(schema, "thing"), []);
  assert.deepEqual(collectSchemaReferences(undefined, "thing"), []);
  assert.deepEqual(collectSchemaReferences(null, "thing"), []);
});

// -- the check ---------------------------------------------------------------

test("a ref whose target is not registered is reported", () => {
  const models = {
    user: { schema: new mongoose.Schema({ name: String }) },
    log: {
      schema: new mongoose.Schema({
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      }),
    },
  };

  assert.deepEqual(findUnresolvedReferences(models), [
    { model: "log", path: "userId", ref: "User" },
  ]);
});

test("the same graph with the casing corrected reports nothing", () => {
  const models = {
    user: { schema: new mongoose.Schema({ name: String }) },
    log: {
      schema: new mongoose.Schema({
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
      }),
    },
  };

  assert.deepEqual(findUnresolvedReferences(models), []);
});

test("the failure message names the field, the target and what is registered", () => {
  const message = describeUnresolvedReference(
    { model: "ActivityLog", path: "userId", ref: "User" },
    ["user", "course", "ActivityLog"],
  );

  assert.match(message, /ActivityLog\.userId/);
  assert.match(message, /"User"/);
  assert.match(message, /MissingSchemaError/);
  // The registered names are the diagnosis: "User" next to "user".
  assert.match(message, /ActivityLog, course, user/);
});

test("verifyModelReferences logs each unresolved reference and returns them", () => {
  const errors = [];
  const models = {
    user: { schema: new mongoose.Schema({ name: String }) },
    log: {
      schema: new mongoose.Schema({
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course" },
      }),
    },
  };

  const result = verifyModelReferences({
    models,
    logger: { error: (message) => errors.push(message) },
  });

  assert.equal(result.checked, 2);
  assert.equal(result.unresolved.length, 2);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /log\.userId/);
  assert.match(errors[1], /log\.courseId/);
});

test("verifyModelReferences is quiet and does not throw on a healthy graph", () => {
  const errors = [];

  const result = verifyModelReferences({
    models: mongoose.models,
    logger: { error: (message) => errors.push(message) },
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(result.unresolved, []);
  assert.ok(result.checked > 0);
});
