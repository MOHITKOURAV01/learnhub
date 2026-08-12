const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

let app;
let User;

test.before(async () => {
  await startTestDatabase();
  app = require("../app");
  User = require("../schemas/userModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

test("registration validation rejects a request missing required fields", async () => {
  const response = await request(app)
    .post("/api/user/register")
    .send({});

  // This used to assert 500. An empty body reached the schema, where the name
  // setter called value.charAt(0) on undefined and the resulting TypeError was
  // reported as an internal error. The request is malformed, so it now answers
  // 400 with a message per field.
  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.equal(typeof response.body.message, "string");
  assert.ok(response.body.errors.name);
  assert.ok(response.body.errors.email);
  assert.ok(response.body.errors.password);
  assert.ok(response.body.errors.type);
});

test("registration refuses a client-supplied admin role", async () => {
  const response = await request(app)
    .post("/api/user/register")
    .send({
      name: "Escalation",
      email: "escalation@example.com",
      password: "password123",
      type: "admin",
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.ok(response.body.errors.type);

  const stored = await User.findOne({ email: "escalation@example.com" });
  assert.equal(stored, null, "no account should have been created");
});

test("login rejects invalid credentials", async () => {
  const password = await bcrypt.hash("correct-password", 10);

  await User.create({
    name: "Test User",
    email: "test@example.com",
    password,
    type: "student",
    isVerified: true,
  });

  const response = await request(app)
    .post("/api/user/login")
    .send({
      email: "test@example.com",
      password: "wrong-password",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, "Invalid email or password");
});

test("protected route rejects a request without a token", async () => {
  const response = await request(app)
    .get("/api/user/getallcoursesteacher");

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, "Authorization header missing");
});

test("protected route rejects an invalid token", async () => {
  const response = await request(app)
    .get("/api/user/getallcoursesteacher")
    .set("Authorization", "Bearer invalid-token");

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, "Token is not valid");
});

test("teacher-only route rejects a student token", async () => {
  const user = await User.create({
    name: "Student User",
    email: "student@example.com",
    password: await bcrypt.hash("student-password", 10),
    type: "student",
    isVerified: true,
  });

  const token = jwt.sign(
    { id: user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  const response = await request(app)
    .get("/api/user/getallcoursesteacher")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, "Forbidden: Access denied");
});
