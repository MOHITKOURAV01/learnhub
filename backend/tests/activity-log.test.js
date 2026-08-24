const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

const {
  MAX_USER_AGENT_LENGTH,
  getClientIp,
  getRequestContext,
  getUserAgent,
} = require("../utils/requestContext");
const { ACTIONS, recordActivity } = require("../utils/activityLog");

// The admin Activity Logs page offers a Logout filter and IP and device
// columns. Only one event was ever written — a login, with no request context
// at all — so the filter matched nothing and both columns were blank on every
// row. A failed attempt left no trace whatsoever.

// -- request context ---------------------------------------------------------

test("the client IP comes from req.ip", () => {
  assert.equal(getClientIp({ ip: "203.0.113.4" }), "203.0.113.4");
});

test("an IPv4-mapped IPv6 address is stored in its plain form", () => {
  // ::ffff:203.0.113.4 and 203.0.113.4 are the same address; an admin
  // searching for one should find rows written as the other.
  assert.equal(getClientIp({ ip: "::ffff:203.0.113.4" }), "203.0.113.4");
});

test("the socket address is used when req.ip is absent", () => {
  assert.equal(getClientIp({ socket: { remoteAddress: "198.51.100.7" } }), "198.51.100.7");
  assert.equal(getClientIp({}), null);
});

test("a forwarded header is not read directly", () => {
  // Express resolves req.ip from X-Forwarded-For only when `trust proxy` is
  // set. Reading the header here would take it at face value on a deployment
  // that is not behind a proxy.
  assert.equal(
    getClientIp({ headers: { "x-forwarded-for": "1.2.3.4" } }),
    null,
  );
});

test("a User-Agent is truncated rather than stored whole", () => {
  const long = "x".repeat(MAX_USER_AGENT_LENGTH + 500);

  assert.equal(
    getUserAgent({ headers: { "user-agent": long } }).length,
    MAX_USER_AGENT_LENGTH,
  );
});

test("a missing User-Agent is null, not an empty string", () => {
  assert.equal(getUserAgent({ headers: {} }), null);
  assert.equal(getUserAgent({ headers: { "user-agent": "   " } }), null);
  assert.deepEqual(getRequestContext({}), { ipAddress: null, userAgent: null });
});

// -- the writer --------------------------------------------------------------

test("a failing write is swallowed rather than raised", async () => {
  // A login that succeeded must not become a 500 because an audit row could
  // not be written.
  const warnings = [];
  const result = await recordActivity({
    action: ACTIONS.LOGIN,
    ActivityLog: {
      async create() {
        throw new Error("collection unavailable");
      },
    },
    logger: { warn: (message) => warnings.push(message) },
  });

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
});

test("the role and email are normalised on the way in", async () => {
  const written = [];
  await recordActivity({
    action: ACTIONS.LOGIN,
    role: "  Admin ",
    email: "  Person@Example.COM ",
    ActivityLog: {
      async create(document) {
        written.push(document);
        return document;
      },
    },
  });

  assert.equal(written[0].role, "admin");
  assert.equal(written[0].email, "person@example.com");
});

test("a row with no user is written without a userId key", async () => {
  const written = [];
  await recordActivity({
    action: ACTIONS.LOGIN_FAILED,
    email: "nobody@example.com",
    ActivityLog: {
      async create(document) {
        written.push(document);
        return document;
      },
    },
  });

  assert.equal("userId" in written[0], false);
});

// -- through the routes ------------------------------------------------------

let app;
let ActivityLog;
let User;

function buildApp() {
  const instance = express();

  instance.use(express.json());
  instance.use("/api/user", require("../routers/userRoutes"));
  instance.use("/api/admin", require("../routers/adminRoutes"));

  return instance;
}

test.before(async () => {
  await startTestDatabase();
  process.env.ADMIN_USERNAME = "root@learnhub.test";
  process.env.ADMIN_PASSWORD = "admin-test-password";
  app = buildApp();
  ActivityLog = require("../schemas/activityLogModel");
  User = require("../schemas/userModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

const PASSWORD = "student-password";
const AGENT = "Mozilla/5.0 (Macintosh) TestRunner/1.0";

async function createStudent() {
  return User.create({
    name: "Sam Student",
    email: "sam@learnhub.test",
    password: await bcrypt.hash(PASSWORD, 10),
    type: "student",
    isVerified: true,
  });
}

test("a successful login records the IP and the device", async () => {
  await createStudent();

  const res = await request(app)
    .post("/api/user/login")
    .set("User-Agent", AGENT)
    .send({ email: "sam@learnhub.test", password: PASSWORD });

  assert.equal(res.body.success, true);

  const [log] = await ActivityLog.find({ action: "login" }).lean();

  assert.equal(log.email, "sam@learnhub.test");
  assert.equal(log.role, "student");
  assert.equal(log.userAgent, AGENT);
  assert.ok(log.ipAddress, "an IP should have been recorded");
  // The controller's fallback for a missing timestamp was always undefined.
  assert.ok(log.createdAt instanceof Date);
});

test("signing out is recorded, so the Logout filter has something to match", async () => {
  const student = await createStudent();
  const token = jwt.sign({ id: String(student._id) }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  const res = await request(app)
    .post("/api/user/logout")
    .set("Authorization", `Bearer ${token}`)
    .set("User-Agent", AGENT);

  assert.equal(res.status, 200);

  const [log] = await ActivityLog.find({ action: "logout" }).lean();

  assert.equal(String(log.userId), String(student._id));
  assert.equal(log.role, "student");
  assert.equal(log.userAgent, AGENT);
});

test("logout cannot be called anonymously", async () => {
  // Otherwise anyone could write log rows for any account.
  const res = await request(app).post("/api/user/logout");

  assert.equal(res.status, 401);
  assert.equal(await ActivityLog.countDocuments({}), 0);
});

test("a wrong password is recorded against the account", async () => {
  const student = await createStudent();

  await request(app)
    .post("/api/user/login")
    .send({ email: "sam@learnhub.test", password: "not-the-password" });

  const [log] = await ActivityLog.find({ action: "login_failed" }).lean();

  assert.equal(String(log.userId), String(student._id));
  assert.equal(log.email, "sam@learnhub.test");
});

test("an attempt against an address with no account is recorded too", async () => {
  await request(app)
    .post("/api/user/login")
    .send({ email: "Ghost@Learnhub.test", password: "guess" });

  const [log] = await ActivityLog.find({ action: "login_failed" }).lean();

  assert.equal(log.email, "ghost@learnhub.test");
  assert.equal(log.userId, undefined);
});

test("the attempted password is never stored", async () => {
  await createStudent();

  await request(app)
    .post("/api/user/login")
    .send({ email: "sam@learnhub.test", password: "hunter2-should-not-appear" });

  const logs = await ActivityLog.find({}).lean();

  assert.doesNotMatch(JSON.stringify(logs), /hunter2/);
});

test("the admin login writes a lowercase role like every other row", async () => {
  await request(app)
    .post("/api/admin/login")
    .set("User-Agent", AGENT)
    .send({ username: "root@learnhub.test", password: "admin-test-password" });

  const [log] = await ActivityLog.find({ action: "login" }).lean();

  assert.equal(log.role, "admin");
  assert.equal(log.userAgent, AGENT);
});

test("a failed admin login is recorded", async () => {
  await request(app)
    .post("/api/admin/login")
    .send({ username: "root@learnhub.test", password: "wrong" });

  assert.equal(await ActivityLog.countDocuments({ action: "login_failed" }), 1);
});

test("the log filter accepts the new action", async () => {
  const adminToken = jwt.sign({ id: "admin", role: "admin" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  await request(app)
    .post("/api/user/login")
    .send({ email: "ghost@learnhub.test", password: "guess" });

  const res = await request(app)
    .get("/api/admin/activity-logs?activity=login_failed")
    .set("Authorization", `Bearer ${adminToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].activity, "login_failed");
});
