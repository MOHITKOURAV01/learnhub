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

// DELETE /api/admin/deleteuser/:userid was registered without authMiddleware
// and pointed at getAllPaymentsController. Because Express matches in
// registration order it shadowed the guarded route further down the file, so
// an anonymous caller received every payment record and no user was ever
// deleted. These tests pin the auth matrix for the whole admin router.

let app;
let User;
let Course;
let CoursePayment;

// The admin router is mounted on its own express instance rather than through
// app.js so this suite exercises only the route table under test.
function buildAdminApp() {
  const instance = express();

  instance.use(express.json());
  instance.use("/api/admin", require("../routers/adminRoutes"));

  return instance;
}

test.before(async () => {
  await startTestDatabase();
  app = buildAdminApp();
  User = require("../schemas/userModel");
  Course = require("../schemas/courseModel");
  CoursePayment = require("../schemas/coursePaymentModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

// authMiddleware treats the literal id "admin" as the platform administrator.
function adminToken() {
  return jwt.sign({ id: "admin", role: "admin" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

async function createStudent(email = "student@example.com") {
  const user = await User.create({
    name: "Student User",
    email,
    password: await bcrypt.hash("student-password", 10),
    type: "student",
    isVerified: true,
  });

  const token = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  return { user, token };
}

async function seedPayment(userId) {
  return CoursePayment.create({
    userId,
    courseId: userId,
    cardDetails: {
      cardholdername: "Card Holder",
      cardnumber: 4242424242424242,
      cvvcode: 123,
      expmonthyear: "12/30",
    },
  });
}

test("DELETE /deleteuser rejects an anonymous caller", async () => {
  const { user } = await createStudent();
  await seedPayment(user._id);

  const response = await request(app).delete(
    `/api/admin/deleteuser/${user._id}`,
  );

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, "Authorization header missing");
});

test("DELETE /deleteuser never returns payment records", async () => {
  const { user } = await createStudent();
  const payment = await seedPayment(user._id);

  const response = await request(app).delete(
    `/api/admin/deleteuser/${user._id}`,
  );

  const body = JSON.stringify(response.body);

  assert.ok(
    !body.includes(String(payment._id)),
    "the response leaked a payment document id",
  );
  assert.ok(
    !body.includes("cardnumber") && !body.includes("cvvcode"),
    "the response leaked stored card fields",
  );
});

test("DELETE /deleteuser rejects a non-admin token", async () => {
  const { user, token } = await createStudent();

  const response = await request(app)
    .delete(`/api/admin/deleteuser/${user._id}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.message, "Forbidden: Access denied");

  const stillThere = await User.findById(user._id);
  assert.notEqual(stillThere, null, "the user must not be deleted");
});

test("DELETE /deleteuser deletes the user for an admin token", async () => {
  const { user } = await createStudent();

  const response = await request(app)
    .delete(`/api/admin/deleteuser/${user._id}`)
    .set("Authorization", `Bearer ${adminToken()}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.message, "User deleted successfully");

  const removed = await User.findById(user._id);
  assert.equal(removed, null, "the user should be gone");
});

test("DELETE /deleteuser returns 404 for an unknown but well formed id", async () => {
  const response = await request(app)
    .delete("/api/admin/deleteuser/64b7f1c2a1b2c3d4e5f60718")
    .set("Authorization", `Bearer ${adminToken()}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.message, "User not found");
});

test("DELETE /deleteuser returns 400 for a malformed id", async () => {
  const response = await request(app)
    .delete("/api/admin/deleteuser/not-an-object-id")
    .set("Authorization", `Bearer ${adminToken()}`);

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Invalid user ID");
});

test("DELETE /deletecourse keeps its admin guard and validates the id", async () => {
  const { token } = await createStudent("course-student@example.com");

  const anonymous = await request(app).delete(
    "/api/admin/deletecourse/64b7f1c2a1b2c3d4e5f60718",
  );
  assert.equal(anonymous.status, 401);

  const asStudent = await request(app)
    .delete("/api/admin/deletecourse/64b7f1c2a1b2c3d4e5f60718")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(asStudent.status, 403);

  const malformed = await request(app)
    .delete("/api/admin/deletecourse/nope")
    .set("Authorization", `Bearer ${adminToken()}`);
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.message, "Invalid course ID");
});

test("POST /reset-password validates the id and requires an admin", async () => {
  const { user, token } = await createStudent("reset@example.com");

  const asStudent = await request(app)
    .post(`/api/admin/reset-password/${user._id}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ newPassword: "brand-new-password" });
  assert.equal(asStudent.status, 403);

  const malformed = await request(app)
    .post("/api/admin/reset-password/nope")
    .set("Authorization", `Bearer ${adminToken()}`)
    .send({ newPassword: "brand-new-password" });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.message, "Invalid user ID");
});

test("read-only admin endpoints are all guarded", async () => {
  const { token } = await createStudent("readonly@example.com");

  const paths = [
    "/api/admin/getallusers",
    "/api/admin/getallcourses",
    "/api/admin/enrolled-courses",
    "/api/admin/payments",
    "/api/admin/activity-logs",
  ];

  for (const path of paths) {
    const anonymous = await request(app).get(path);
    assert.equal(anonymous.status, 401, `${path} should reject anonymous`);

    const asStudent = await request(app)
      .get(path)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(asStudent.status, 403, `${path} should reject a student`);
  }
});

test("the admin router registers each path exactly once", () => {
  const adminRouter = require("../routers/adminRoutes");

  const registrations = adminRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => {
      const methods = Object.keys(layer.route.methods).sort().join(",");
      return `${methods} ${layer.route.path}`;
    });

  const duplicates = registrations.filter(
    (entry, index) => registrations.indexOf(entry) !== index,
  );

  assert.deepEqual(
    duplicates,
    [],
    `these routes are registered more than once: ${duplicates.join(", ")}`,
  );
});

test("every admin route except login runs authMiddleware and checkRole", () => {
  const adminRouter = require("../routers/adminRoutes");

  const unguarded = adminRouter.stack
    .filter((layer) => layer.route && layer.route.path !== "/login")
    .filter((layer) => layer.route.stack.length < 3)
    .map((layer) => layer.route.path);

  assert.deepEqual(
    unguarded,
    [],
    `these admin routes are missing a guard: ${unguarded.join(", ")}`,
  );
});
