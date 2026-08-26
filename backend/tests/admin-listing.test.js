const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

const {
  ADMIN_COURSE_FIELDS,
  buildUserFilter,
  buildUserSort,
  toAdminCourseRow,
  toAdminEnrollmentRow,
} = require("../utils/adminListing");
const { countSections } = require("../utils/courseSections");

const ADMIN_USERNAME = "listing-admin";
const ADMIN_PASSWORD = "listing-admin-password";

let app;
let User;
let Course;

test.before(async () => {
  await startTestDatabase();
  process.env.ADMIN_USERNAME = ADMIN_USERNAME;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD_HASH;

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

async function adminToken() {
  const { body } = await request(app)
    .post("/api/admin/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

  return body.token;
}

async function seedUsers(count) {
  const password = await bcrypt.hash("password123", 10);
  const docs = [];

  for (let i = 0; i < count; i += 1) {
    docs.push({
      name: `User ${String(i).padStart(3, "0")}`,
      email: `u${i}@example.com`,
      password,
      type: i % 5 === 0 ? "teacher" : "student",
      isVerified: i % 2 === 0,
    });
  }

  await User.insertMany(docs);
}

async function seedCourses(count) {
  const docs = [];

  for (let i = 0; i < count; i += 1) {
    docs.push({
      userId: "teacher-id",
      C_educator: "Jane Educator",
      C_title: `Course ${String(i).padStart(3, "0")}`,
      C_categories: i % 2 === 0 ? "Web Development" : "Programming",
      C_price: i % 3 === 0 ? "0" : String(20 + i),
      C_description: `Description for course ${i}`,
      enrolled: i,
      sections: [{ S_title: "One", S_content: { path: `/uploads/${i}.mp4` } }],
    });
  }

  await Course.insertMany(docs);
}

/* ------------------------------------------------------------------ *
 * utils/adminListing
 * ------------------------------------------------------------------ */

test("the user search is escaped before it reaches a RegExp", () => {
  const filter = buildUserFilter({ search: "a+b (c)" });

  assert.equal(filter.$or.length, 2);
  assert.doesNotThrow(() => new RegExp(filter.$or[0].name.$regex));
  assert.equal(filter.$or[1].email.$regex.test("A+B (C)@x.com"), true);
});

test("an empty search adds no clause", () => {
  assert.deepEqual(buildUserFilter({}), {});
  assert.deepEqual(buildUserFilter({ search: "   " }), {});
});

test("only a known role is accepted as a filter", () => {
  assert.equal(buildUserFilter({ role: "teacher" }).type, "teacher");
  assert.equal(buildUserFilter({ role: "TEACHER" }).type, "teacher");
  assert.equal(buildUserFilter({ role: "superuser" }).type, undefined);
  assert.equal(buildUserFilter({ role: "" }).type, undefined);
});

test("the verified filter is a tri-state, not a truthiness check", () => {
  assert.equal(buildUserFilter({ verified: "verified" }).isVerified, true);
  // "unverified" must mean false, not "absent".
  assert.equal(buildUserFilter({ verified: "unverified" }).isVerified, false);
  assert.equal(buildUserFilter({ verified: "maybe" }).isVerified, undefined);
  assert.equal(buildUserFilter({}).isVerified, undefined);
});

test("user sorts are a closed set with a stable tiebreak", () => {
  assert.deepEqual(buildUserSort({ sort: "name" }), { name: 1, _id: 1 });
  assert.deepEqual(buildUserSort({ sort: "email" }), { email: 1, _id: 1 });
  assert.deepEqual(buildUserSort({ sort: "role" }), {
    type: 1,
    name: 1,
    _id: 1,
  });
  assert.deepEqual(buildUserSort({ sort: "'; drop" }), {
    createdAt: -1,
    _id: -1,
  });
});

test("a course row carries a count and never a section list", () => {
  const row = toAdminCourseRow(
    {
      _id: "abc",
      C_title: "Intro",
      sections: [{ S_content: { path: "/uploads/secret.mp4" } }, {}],
    },
    countSections,
  );

  assert.equal(row.sectionCount, 2);
  assert.equal(row.sections, undefined);
  assert.equal(JSON.stringify(row).includes("secret.mp4"), false);
});

test("a course row copes with every shape sections takes", () => {
  assert.equal(toAdminCourseRow({ sections: { 0: {}, 1: {} } }, countSections).sectionCount, 2);
  assert.equal(toAdminCourseRow({}, countSections).sectionCount, 0);
  assert.equal(toAdminCourseRow({ sections: null }, countSections).sectionCount, 0);
});

test("a course row fills in the blanks rather than emitting undefined", () => {
  const row = toAdminCourseRow({}, countSections);

  assert.equal(row.C_title, "Untitled course");
  assert.equal(row.C_educator, "Unknown educator");
  assert.equal(row.C_price, "free");
  assert.equal(row.enrolled, 0);
});

test("an enrolment whose user or course was deleted is flagged, not blanked", () => {
  const orphan = toAdminEnrollmentRow({
    _id: "e1",
    // populate() resolves a dangling reference to null, which the dashboard
    // rendered as two empty cells.
    userId: null,
    courseId: { _id: "c1", C_title: "Intro" },
    course_Length: 3,
    progress: [{ sectionId: 0 }],
  });

  assert.equal(orphan.orphaned, true);
  assert.equal(orphan.user, null);
  assert.equal(orphan.course.C_title, "Intro");
  assert.equal(orphan.completed, 1);
  assert.equal(orphan.courseLength, 3);
});

test("a complete enrolment row is not flagged", () => {
  const row = toAdminEnrollmentRow({
    _id: "e1",
    userId: { _id: "u1", name: "Alex", email: "a@x.com" },
    courseId: { _id: "c1", C_title: "Intro" },
    course_Length: 2,
    progress: [],
  });

  assert.equal(row.orphaned, false);
  assert.equal(row.user.name, "Alex");
  assert.equal(row.completed, 0);
});

test("the admin course projection excludes nothing the table needs", () => {
  for (const field of ["C_title", "C_educator", "C_categories", "C_price", "enrolled"]) {
    assert.ok(ADMIN_COURSE_FIELDS.includes(field), `${field} is missing`);
  }
});

/* ------------------------------------------------------------------ *
 * GET /api/admin/getallusers
 * ------------------------------------------------------------------ */

test("the user list is paginated instead of returning every account", async () => {
  await seedUsers(40);
  const token = await adminToken();

  const response = await request(app)
    .get("/api/admin/getallusers?page=2&limit=10")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  // On main this was 40, whatever the query string said.
  assert.equal(response.body.data.length, 10);
  assert.equal(response.body.pagination.page, 2);
  assert.equal(response.body.pagination.totalItems, 40);
  assert.equal(response.body.pagination.totalPages, 4);
  assert.equal(response.body.pagination.hasNextPage, true);
  assert.equal(response.body.pagination.hasPreviousPage, true);
});

test("an absurd limit is capped rather than honoured", async () => {
  await seedUsers(30);
  const token = await adminToken();

  const response = await request(app)
    .get("/api/admin/getallusers?limit=100000")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.body.pagination.limit, 100);
});

test("the user search runs on the server, over every account", async () => {
  await seedUsers(30);
  const token = await adminToken();

  const response = await request(app)
    // User 027 is on page three at the default limit of twelve, so a
    // client-side filter over the first page could not have found it.
    .get("/api/admin/getallusers?search=u27@example.com")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.body.pagination.totalItems, 1);
  assert.equal(response.body.data[0].email, "u27@example.com");
});

test("a search value that would break a RegExp is a 200, not a 500", async () => {
  await seedUsers(3);
  const token = await adminToken();

  const response = await request(app)
    .get("/api/admin/getallusers?search=%28unclosed")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
});

test("the role filter narrows the list and the totals", async () => {
  await seedUsers(20);
  const token = await adminToken();

  const response = await request(app)
    .get("/api/admin/getallusers?role=teacher&limit=100")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.body.data.length, 4);
  assert.ok(response.body.data.every((user) => user.type === "teacher"));
  assert.equal(response.body.pagination.totalItems, 4);
});

test("the role summary covers every account, not the page on screen", async () => {
  await seedUsers(20);
  const token = await adminToken();

  const response = await request(app)
    .get("/api/admin/getallusers?limit=5")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.body.data.length, 5);
  assert.equal(response.body.summary.total, 20);
  assert.equal(response.body.summary.teacher, 4);
  assert.equal(response.body.summary.student, 16);
});

test("sorting by name is applied by the database, not by the client", async () => {
  await seedUsers(20);
  const token = await adminToken();

  const response = await request(app)
    .get("/api/admin/getallusers?sort=name&limit=3")
    .set("Authorization", `Bearer ${token}`);

  assert.deepEqual(
    response.body.data.map((user) => user.name),
    ["User 000", "User 001", "User 002"],
  );
});

/* ------------------------------------------------------------------ *
 * GET /api/admin/getallcourses
 * ------------------------------------------------------------------ */

test("the course list is paginated and carries no section paths", async () => {
  await seedCourses(20);
  const token = await adminToken();

  const response = await request(app)
    .get("/api/admin/getallcourses?page=1&limit=5")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 5);
  assert.equal(response.body.pagination.totalItems, 20);

  const [course] = response.body.data;

  assert.equal(course.sectionCount, 1);
  assert.equal(course.sections, undefined);
  // The paths #76 is about have no business on this route.
  assert.equal(JSON.stringify(response.body).includes("/uploads/"), false);
});

test("the admin course search reuses the catalogue's rules", async () => {
  await seedCourses(20);
  const token = await adminToken();

  const response = await request(app)
    .get("/api/admin/getallcourses?search=Course 017")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.body.pagination.totalItems, 1);
  assert.equal(response.body.data[0].C_title, "Course 017");
});

test("the free/paid filter works the same way it does in the catalogue", async () => {
  await seedCourses(20);
  const token = await adminToken();

  const response = await request(app)
    .get("/api/admin/getallcourses?priceType=free&limit=100")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.body.data.length, 7);
  assert.ok(response.body.data.every((course) => course.C_price === "0"));
});

/* ------------------------------------------------------------------ *
 * GET /api/admin/enrolled-courses
 * ------------------------------------------------------------------ */

test("the enrolment list is paginated and flags orphaned rows", async () => {
  const mongoose = require("mongoose");
  const EnrolledCourse = require("../schemas/enrolledCourseModel");

  const user = await User.create({
    name: "Alex",
    email: "alex@example.com",
    password: await bcrypt.hash("password123", 10),
    type: "student",
    isVerified: true,
  });
  const course = await Course.create({
    userId: "teacher-id",
    C_educator: "Jane",
    C_title: "Intro",
    C_categories: "Web",
    C_description: "d",
    sections: [{}],
  });

  await EnrolledCourse.create({
    userId: user._id,
    courseId: course._id,
    course_Length: 1,
  });
  // A course that has since been deleted.
  await EnrolledCourse.create({
    userId: user._id,
    courseId: new mongoose.Types.ObjectId(),
    course_Length: 4,
  });

  const token = await adminToken();
  const response = await request(app)
    .get("/api/admin/enrolled-courses?limit=10")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 2);
  assert.equal(response.body.pagination.totalItems, 2);

  const orphan = response.body.data.find((row) => row.orphaned);

  assert.ok(orphan, "the dangling enrolment should be flagged");
  assert.equal(orphan.course, null);
  assert.ok(orphan.user);
});
