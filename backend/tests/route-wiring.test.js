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

// The hardened controllers added for #39 and #40 were only covered by unit
// tests that required them directly. The routers kept serving the superseded
// implementations, so both suites stayed green while the API stayed
// vulnerable. These tests drive the real HTTP routes instead.

let app;
let User;
let Course;
let EnrolledCourse;

test.before(async () => {
  await startTestDatabase();
  app = require("../app");
  User = require("../schemas/userModel");
  Course = require("../schemas/courseModel");
  EnrolledCourse = require("../schemas/enrolledCourseModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

async function createUser({ email, type }) {
  return User.create({
    name: "Route Test User",
    email,
    password: await bcrypt.hash("route-test-password", 10),
    type,
    isVerified: true,
  });
}

function tokenFor(user) {
  return jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

function courseFixture(ownerId) {
  return {
    userId: ownerId.toString(),
    C_educator: "Route Educator",
    C_title: "Route Wiring Course",
    C_categories: "Testing",
    C_price: "free",
    C_description: "A course used to exercise the router wiring.",
    sections: [
      { S_title: "Section one", S_description: "First section" },
      { S_title: "Section two", S_description: "Second section" },
    ],
  };
}

test("DELETE /api/user/deletecourse refuses a course the teacher does not own", async () => {
  const owner = await createUser({ email: "owner@example.com", type: "teacher" });
  const intruder = await createUser({
    email: "intruder@example.com",
    type: "teacher",
  });

  const course = await Course.create(courseFixture(owner._id));

  const response = await request(app)
    .delete(`/api/user/deletecourse/${course._id}`)
    .set("Authorization", `Bearer ${tokenFor(intruder)}`);

  assert.equal(response.status, 403);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, "You can only delete courses you own");

  const stillThere = await Course.findById(course._id);
  assert.notEqual(stillThere, null, "the course must survive the attempt");
});

test("DELETE /api/user/deletecourse allows the owning teacher", async () => {
  const owner = await createUser({ email: "owner2@example.com", type: "teacher" });
  const course = await Course.create(courseFixture(owner._id));

  const response = await request(app)
    .delete(`/api/user/deletecourse/${course._id}`)
    .set("Authorization", `Bearer ${tokenFor(owner)}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);

  const removed = await Course.findById(course._id);
  assert.equal(removed, null, "the course should be gone");
});

test("DELETE /api/user/deletecourse rejects a malformed course id with 400", async () => {
  const owner = await createUser({ email: "owner3@example.com", type: "teacher" });

  const response = await request(app)
    .delete("/api/user/deletecourse/not-an-object-id")
    .set("Authorization", `Bearer ${tokenFor(owner)}`);

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Invalid course ID");
});

test("POST /api/user/completemodule does not duplicate progress on repeat calls", async () => {
  const student = await createUser({
    email: "student@example.com",
    type: "student",
  });
  const teacher = await createUser({
    email: "teacher@example.com",
    type: "teacher",
  });

  const course = await Course.create(courseFixture(teacher._id));

  await EnrolledCourse.create({
    courseId: course._id,
    userId: student._id,
    course_Length: 2,
  });

  const token = tokenFor(student);
  const payload = { courseId: course._id.toString(), sectionId: 0 };

  const first = await request(app)
    .post("/api/user/completemodule")
    .set("Authorization", `Bearer ${token}`)
    .send(payload);

  assert.equal(first.status, 200);
  assert.equal(first.body.alreadyCompleted, false);

  const second = await request(app)
    .post("/api/user/completemodule")
    .set("Authorization", `Bearer ${token}`)
    .send(payload);

  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyCompleted, true);

  const enrollment = await EnrolledCourse.findOne({
    courseId: course._id,
    userId: student._id,
  });

  assert.equal(
    enrollment.progress.length,
    1,
    "a repeated completion must not append a second entry",
  );
});

test("POST /api/user/completemodule rejects a section that is not in the course", async () => {
  const student = await createUser({
    email: "student2@example.com",
    type: "student",
  });
  const teacher = await createUser({
    email: "teacher2@example.com",
    type: "teacher",
  });

  const course = await Course.create(courseFixture(teacher._id));

  await EnrolledCourse.create({
    courseId: course._id,
    userId: student._id,
    course_Length: 2,
  });

  const response = await request(app)
    .post("/api/user/completemodule")
    .set("Authorization", `Bearer ${tokenFor(student)}`)
    .send({ courseId: course._id.toString(), sectionId: 99 });

  assert.equal(response.status, 404);
  assert.equal(response.body.message, "Section not found in this course");
});

test("POST /api/user/completemodule rejects a student who is not enrolled", async () => {
  const student = await createUser({
    email: "student3@example.com",
    type: "student",
  });
  const teacher = await createUser({
    email: "teacher3@example.com",
    type: "teacher",
  });

  const course = await Course.create(courseFixture(teacher._id));

  const response = await request(app)
    .post("/api/user/completemodule")
    .set("Authorization", `Bearer ${tokenFor(student)}`)
    .send({ courseId: course._id.toString(), sectionId: 0 });

  assert.equal(response.status, 403);
  assert.equal(response.body.message, "User is not enrolled in this course");
});

test("the user router serves the hardened controller instances", () => {
  const {
    deleteCourseController,
  } = require("../controllers/courseDeletionController");
  const {
    completeSectionController,
  } = require("../controllers/progressController");
  const userControllers = require("../controllers/userControllers");

  // The superseded copies must not come back through the aggregator, or the
  // router could silently be pointed at them again.
  assert.equal(
    userControllers.deleteCourseController,
    undefined,
    "userControllers should no longer export a course deletion handler",
  );
  assert.equal(
    userControllers.completeSectionController,
    undefined,
    "userControllers should no longer export a progress handler",
  );

  assert.equal(typeof deleteCourseController, "function");
  assert.equal(typeof completeSectionController, "function");
});
