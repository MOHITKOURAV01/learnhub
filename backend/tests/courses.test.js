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
let Course;

test.before(async () => {
  await startTestDatabase();
  app = require("../app");
  User = require("../schemas/userModel");
  Course = require("../schemas/courseModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

test("course list returns a successful JSON response", async () => {
  await Course.create({
    userId: "teacher-id",
    C_educator: "Test Teacher",
    C_title: "Node Testing",
    C_categories: "Backend",
    C_price: "free",
    C_description: "Testing course",
    sections: [],
  });

  const response = await request(app)
    .get("/api/user/getallcourses");

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(Array.isArray(response.body.data));
  assert.equal(response.body.data.length, 1);
});

test("course content returns 404 for a missing course", async () => {
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
    .get("/api/user/coursecontent/64b000000000000000000001")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, "No such course found");
});

test("course list keeps errors in a consistent JSON envelope", async () => {
  const response = await request(app)
    .get("/api/user/getallcourses");

  assert.equal(response.headers["content-type"].includes("application/json"), true);
  assert.equal(typeof response.body.success, "boolean");
});
