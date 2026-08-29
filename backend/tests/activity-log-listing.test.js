const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

const request = require("supertest");

// #113. GET /api/admin/activity-logs populates the account that produced each
// event:
//
//   .populate("userId", "name email type")
//
// and activityLogModel declared `ref: "User"` while the user model is
// registered as `"user"`. Mongoose resolves a ref by exact name, so the
// populate threw MissingSchemaError, the handler's catch turned it into a 500,
// and the admin Activity Logs page rendered "Activity logs could not be
// loaded." from the first successful sign-in onwards.
//
// #87 built the write side and tested it thoroughly. Nothing read it back.
// These tests are the read side.

let User;
let ActivityLog;
let getActivityLogsController;
let app;

test.before(async () => {
  await startTestDatabase();

  User = require("../schemas/userModel");
  ActivityLog = require("../schemas/activityLogModel");
  ({ getActivityLogsController } = require("../controllers/activityLogController"));

  // The controller alone, with no auth in front of it. Who may reach the route
  // is adminRoutes' business and admin-routes.test.js already covers it.
  app = express();
  app.use(express.json());
  app.get("/activity-logs", getActivityLogsController);
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

const createUser = (overrides = {}) =>
  User.create({
    name: "Ada",
    email: "ada@example.com",
    password: "hashed",
    type: "student",
    isVerified: true,
    ...overrides,
  });

// -- the regression ----------------------------------------------------------

test("a log row that carries a userId is listed rather than answering 500", async () => {
  // The exact shape that broke it: one row with a real userId. Before the fix
  // this response was 500 { message: "Unable to retrieve activity logs." }.
  const user = await createUser();

  await ActivityLog.create({
    userId: user._id,
    action: "login",
    role: "student",
    email: user.email,
    ipAddress: "203.0.113.4",
    userAgent: "Mozilla/5.0",
  });

  const response = await request(app).get("/activity-logs");

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.length, 1);
});

test("the populated account supplies the name the row does not carry", async () => {
  // The whole point of the populate. `name` is not stored on the log row, so
  // it can only come from the join — which is why this is the assertion that
  // proves the ref resolves rather than being skipped.
  const user = await createUser({ name: "Grace", email: "grace@example.com" });

  await ActivityLog.create({
    userId: user._id,
    action: "login",
    role: "student",
    email: user.email,
  });

  const { body } = await request(app).get("/activity-logs");

  assert.equal(body.data[0].user.name, "Grace");
  assert.equal(body.data[0].user.id, String(user._id));
  assert.equal(body.data[0].user.email, "grace@example.com");
});

test("a database holding only failed logins was never affected", async () => {
  // Why this survived review for so long. recordActivity omits userId entirely
  // for a failed attempt, and populating a set of documents whose paths are
  // all null never resolves the model — so the endpoint worked perfectly until
  // somebody signed in successfully.
  await ActivityLog.create({
    action: "login_failed",
    role: "student",
    email: "nobody@example.com",
  });

  const response = await request(app).get("/activity-logs");

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].user.id, null);
  assert.equal(response.body.data[0].user.email, "nobody@example.com");
});

test("one unresolvable row does not take the page down with it", async () => {
  // An admin login writes no userId, and a deleted account leaves a row whose
  // userId points at nothing. Both share a page with ordinary rows.
  const user = await createUser();

  await ActivityLog.create({ userId: user._id, action: "login", role: "student", email: user.email });
  await ActivityLog.create({ action: "login", role: "admin", email: "admin@example.com" });
  await ActivityLog.create({
    userId: new (require("mongoose").Types.ObjectId)(),
    action: "logout",
    role: "teacher",
    email: "gone@example.com",
  });

  const { status, body } = await request(app).get("/activity-logs");

  assert.equal(status, 200);
  assert.equal(body.data.length, 3);

  const byEmail = new Map(body.data.map((row) => [row.user.email, row]));

  assert.equal(byEmail.get("ada@example.com").user.name, "Ada");
  // No userId at all: the row's own fields are what is left.
  assert.equal(byEmail.get("admin@example.com").user.name, null);
  assert.equal(byEmail.get("admin@example.com").user.role, "admin");
  // A userId that resolves to nothing, which is not the same as no userId.
  assert.equal(byEmail.get("gone@example.com").user.name, null);
  assert.equal(byEmail.get("gone@example.com").user.role, "teacher");
});

// -- the rest of the read path, now that it can be reached -------------------

test("rows come back newest first, and oldest first when asked", async () => {
  const user = await createUser();

  await ActivityLog.create({
    userId: user._id, action: "login", email: user.email, role: "student",
    timestamp: new Date("2026-01-01T10:00:00Z"),
  });
  await ActivityLog.create({
    userId: user._id, action: "logout", email: user.email, role: "student",
    timestamp: new Date("2026-01-02T10:00:00Z"),
  });

  const newest = await request(app).get("/activity-logs");
  assert.deepEqual(newest.body.data.map((row) => row.activity), ["logout", "login"]);

  const oldest = await request(app).get("/activity-logs?sort=oldest");
  assert.deepEqual(oldest.body.data.map((row) => row.activity), ["login", "logout"]);
});

test("the activity and role filters narrow the list", async () => {
  const student = await createUser();
  const teacher = await createUser({ name: "Tess", email: "tess@example.com", type: "teacher" });

  await ActivityLog.create({ userId: student._id, action: "login", role: "student", email: student.email });
  await ActivityLog.create({ userId: teacher._id, action: "login", role: "teacher", email: teacher.email });
  await ActivityLog.create({ action: "login_failed", role: "teacher", email: teacher.email });

  const failed = await request(app).get("/activity-logs?activity=login_failed");
  assert.equal(failed.body.data.length, 1);
  assert.equal(failed.body.data[0].activity, "login_failed");

  const teachers = await request(app).get("/activity-logs?role=teacher");
  assert.equal(teachers.body.data.length, 2);

  const both = await request(app).get("/activity-logs?role=student&activity=login");
  assert.equal(both.body.data.length, 1);
  assert.equal(both.body.data[0].user.email, student.email);
});

test("an unknown filter value is rejected rather than ignored", async () => {
  const activity = await request(app).get("/activity-logs?activity=deleted");
  assert.equal(activity.status, 400);
  assert.equal(activity.body.message, "Invalid activity filter.");

  const role = await request(app).get("/activity-logs?role=superuser");
  assert.equal(role.status, 400);
  assert.equal(role.body.message, "Invalid role filter.");

  const sort = await request(app).get("/activity-logs?sort=sideways");
  assert.equal(sort.status, 400);
  assert.equal(sort.body.message, "Invalid sort option.");
});

test("search matches the IP and the User-Agent, which #87 started storing", async () => {
  const user = await createUser();

  await ActivityLog.create({
    userId: user._id, action: "login", role: "student", email: user.email,
    ipAddress: "203.0.113.4", userAgent: "Mozilla/5.0 (Macintosh)",
  });
  await ActivityLog.create({
    userId: user._id, action: "login", role: "student", email: user.email,
    ipAddress: "198.51.100.7", userAgent: "curl/8.4.0",
  });

  const byIp = await request(app).get("/activity-logs?search=203.0.113.4");
  assert.equal(byIp.body.data.length, 1);
  assert.equal(byIp.body.data[0].ipAddress, "203.0.113.4");

  const byAgent = await request(app).get("/activity-logs?search=curl");
  assert.equal(byAgent.body.data.length, 1);
  assert.equal(byAgent.body.data[0].userAgent, "curl/8.4.0");
});

test("a regex metacharacter in the search is escaped, not executed", async () => {
  const user = await createUser();

  await ActivityLog.create({
    userId: user._id, action: "login", role: "student", email: user.email,
  });

  // An unescaped "(" is enough to turn a search box into a 500.
  const response = await request(app).get("/activity-logs?search=%28");

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 0);
});

test("pagination reports the whole set, not the page", async () => {
  const user = await createUser();

  for (let index = 0; index < 25; index += 1) {
    await ActivityLog.create({
      userId: user._id, action: "login", role: "student", email: user.email,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)),
    });
  }

  const { body } = await request(app).get("/activity-logs?page=2&limit=10");

  assert.equal(body.data.length, 10);
  assert.deepEqual(body.pagination, {
    page: 2,
    limit: 10,
    totalItems: 25,
    totalPages: 3,
    hasPreviousPage: true,
    hasNextPage: true,
  });
});

test("a page past the end is clamped to the last one that exists", async () => {
  const user = await createUser();

  await ActivityLog.create({ userId: user._id, action: "login", role: "student", email: user.email });

  const { body } = await request(app).get("/activity-logs?page=99&limit=10");

  assert.equal(body.pagination.page, 1);
  assert.equal(body.data.length, 1);
});

test("an empty log is an empty list, not an error", async () => {
  const { status, body } = await request(app).get("/activity-logs");

  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.totalItems, 0);
});
