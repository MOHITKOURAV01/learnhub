const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

const {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MISSING_COURSE,
  bookmarkAggregateOptions,
  buildBookmarkPipeline,
  buildBookmarkSort,
  buildFilterStages,
  clampedPage,
  parseSavedCoursesQuery,
  readBookmarkFacet,
  toSavedCourseRow,
} = require("../utils/bookmarkListing");

let app;
let User;
let Course;
let CourseBookmark;

test.before(async () => {
  await startTestDatabase();
  process.env.JWT_SECRET = process.env.JWT_SECRET || "bookmark-listing-secret";

  app = require("../app");
  User = require("../schemas/userModel");
  Course = require("../schemas/courseModel");
  CourseBookmark = require("../schemas/courseBookmarkModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

const CATEGORIES = [
  "IT & Software",
  "Finance & Accounting",
  "Personal Development",
];

async function seedWishlist({ count = 30 } = {}) {
  const password = await bcrypt.hash("password123", 10);

  const student = await User.create({
    name: "Priya Sharma",
    email: "priya@example.com",
    password,
    type: "student",
    isVerified: true,
  });

  const courses = [];

  for (let i = 0; i < count; i += 1) {
    courses.push(
      await Course.create({
        userId: String(student._id),
        C_educator: i % 2 === 0 ? "Asha Rao" : "Vikram Nair",
        C_title: `Course ${String(i).padStart(2, "0")}`,
        C_categories: CATEGORIES[i % CATEGORIES.length],
        // Every third course is free; one carries a grouped price.
        C_price: i % 3 === 0 ? "free" : i === 1 ? "1,299" : String(100 + i),
        C_description: i === 5 ? "Kubernetes in anger" : "A practical course",
        sections: [],
      }),
    );
  }

  await CourseBookmark.insertMany(
    courses.map((course, i) => ({
      userId: student._id,
      courseId: course._id,
      createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
      updatedAt: new Date(Date.UTC(2026, 0, 1 + i)),
    })),
  );

  const token = jwt.sign({ id: student._id }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });

  return { student, courses, token };
}

const get = (token, query = "") =>
  request(app)
    .get(`/api/bookmarks${query}`)
    .set("Authorization", `Bearer ${token}`);

// -- query parsing -----------------------------------------------------------

test("the default query is page one at the wishlist's page size", () => {
  const { valid, value } = parseSavedCoursesQuery({});

  assert.equal(valid, true);
  assert.equal(value.page, 1);
  assert.equal(value.limit, DEFAULT_LIMIT);
  assert.equal(value.sort, "recent");
});

test("limit is capped, so one request cannot ask for the whole wishlist", () => {
  assert.equal(parseSavedCoursesQuery({ limit: "9999" }).value.limit, MAX_LIMIT);
});

test("the old rejection messages are preserved exactly", () => {
  assert.equal(
    parseSavedCoursesQuery({ access: "cheap" }).message,
    "Invalid access filter.",
  );
  assert.equal(
    parseSavedCoursesQuery({ availability: "maybe" }).message,
    "Invalid availability filter.",
  );
  assert.equal(
    parseSavedCoursesQuery({ sort: "rating" }).message,
    "Invalid saved-course sort option.",
  );
});

test("search is lowercased and truncated the way it was", () => {
  const { value } = parseSavedCoursesQuery({ search: `  ${"a".repeat(200)}B ` });

  assert.equal(value.search.length, 120);
  assert.equal(value.search, value.search.toLowerCase());
});

// -- the pipeline ------------------------------------------------------------

test("the page is skipped and limited by the database, not by a slice", () => {
  const { value } = parseSavedCoursesQuery({ page: "3", limit: "12" });
  const pipeline = buildBookmarkPipeline("user-1", value);
  const rows = pipeline.at(-1).$facet.rows;

  assert.deepEqual(
    rows.find((stage) => stage.$skip !== undefined),
    { $skip: 24 },
  );
  assert.deepEqual(
    rows.find((stage) => stage.$limit !== undefined),
    { $limit: 12 },
  );
});

test("the join projects a handful of fields, not the whole course", () => {
  const pipeline = buildBookmarkPipeline(
    "user-1",
    parseSavedCoursesQuery({}).value,
  );
  const lookup = pipeline.find((stage) => stage.$lookup).$lookup;
  const projected = lookup.pipeline[0].$project;

  assert.equal(Object.hasOwn(projected, "C_title"), true);
  // sections is the field that made the old admin course list expensive (#96).
  assert.equal(Object.hasOwn(projected, "sections"), false);
});

// The `deleted` availability filter exists precisely for these rows.
test("a bookmark whose course is gone is never dropped by the join", () => {
  const pipeline = buildBookmarkPipeline(
    "user-1",
    parseSavedCoursesQuery({}).value,
  );
  const unwind = pipeline.find((stage) => stage.$unwind).$unwind;

  assert.equal(unwind.preserveNullAndEmptyArrays, true);
});

test("the search value is escaped before it reaches a regex", () => {
  const stages = buildFilterStages({ search: "a(b" });

  assert.equal(stages[0].$match.searchText.$regex, "a\\(b");
  assert.doesNotThrow(() => new RegExp(stages[0].$match.searchText.$regex));
});

test("a category is matched whole, not as a substring", () => {
  const stages = buildFilterStages({ category: "IT & Software" });

  assert.match(stages[0].$match.categoryValue.$regex, /^\^/);
  assert.match(stages[0].$match.categoryValue.$regex, /\$$/);
});

test("no filters means no filter stages", () => {
  assert.deepEqual(buildFilterStages({}), []);
});

// The dropdown must not shrink as the user filters with it.
test("the category list is built without the filters applied", () => {
  const { value } = parseSavedCoursesQuery({ category: "IT & Software" });
  const facet = buildBookmarkPipeline("user-1", value).at(-1).$facet;

  assert.equal(
    facet.rows.some((stage) => stage.$match?.categoryValue),
    true,
  );
  assert.equal(
    facet.categories.some((stage) => stage.$match?.categoryValue),
    false,
  );
});

test("the row count uses the same filters as the rows", () => {
  const { value } = parseSavedCoursesQuery({ access: "free" });
  const facet = buildBookmarkPipeline("user-1", value).at(-1).$facet;

  assert.equal(
    facet.total.some((stage) => stage.$match?.accessType === "free"),
    true,
  );
});

test("every sort carries an _id tiebreak, so a page boundary is stable", () => {
  for (const sort of [
    "recent",
    "title-asc",
    "title-desc",
    "price-asc",
    "price-desc",
  ]) {
    assert.ok(Object.hasOwn(buildBookmarkSort(sort), "_id"), sort);
  }
});

// Collation is what keeps title-asc behaving like the localeCompare it replaces
// rather than sorting every uppercase title first.
test("the title sorts ask for a collation and the others do not", () => {
  assert.equal(
    bookmarkAggregateOptions({ sort: "title-asc" }).collation.locale,
    "en",
  );
  assert.deepEqual(bookmarkAggregateOptions({ sort: "recent" }), {});
});

test("the course collection for the join is injectable", () => {
  const pipeline = buildBookmarkPipeline(
    "user-1",
    parseSavedCoursesQuery({}).value,
    { courseCollection: "catalog" },
  );

  assert.equal(pipeline.find((stage) => stage.$lookup).$lookup.from, "catalog");
});

// -- shaping -----------------------------------------------------------------

test("a deleted course keeps the placeholder the wishlist renders", () => {
  const row = toSavedCourseRow({
    _id: "b1",
    createdAt: null,
    availability: "deleted",
  });

  assert.equal(row.course.id, null);
  assert.equal(row.course.title, MISSING_COURSE.title);
  assert.equal(row.course.accessType, "unavailable");
  assert.equal(row.course.availability, "deleted");
});

test("a course with no price reads as Free", () => {
  const row = toSavedCourseRow({
    _id: "b1",
    availability: "available",
    accessType: "free",
    numericPrice: 0,
    courseId: "c1",
    title: "Intro",
    price: "",
  });

  assert.equal(row.course.price, "Free");
  assert.equal(row.course.numericPrice, 0);
});

test("pagination comes from the database's count", () => {
  const result = readBookmarkFacet(
    { rows: [], total: [{ value: 37 }], categories: [] },
    { page: 2, limit: 12 },
  );

  assert.equal(result.pagination.totalItems, 37);
  assert.equal(result.pagination.totalPages, 4);
  assert.equal(result.pagination.hasNextPage, true);
});

test("an empty facet reads as an empty wishlist, not a crash", () => {
  const result = readBookmarkFacet(undefined, { page: 1, limit: 12 });

  assert.deepEqual(result.data, []);
  assert.deepEqual(result.categories, []);
  assert.equal(result.pagination.totalItems, 0);
});

test("a page past the end is detected from the count", () => {
  assert.equal(clampedPage({ page: 9, limit: 12 }, 37), 4);
  assert.equal(clampedPage({ page: 2, limit: 12 }, 37), null);
  assert.equal(clampedPage({ page: 9, limit: 12 }, 0), null);
});

// -- end to end --------------------------------------------------------------

test("the endpoint returns one page and the true total", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const { body } = await get(token, "?page=1&limit=12").expect(200);

  assert.equal(body.success, true);
  assert.equal(body.data.length, 12);
  assert.equal(body.pagination.totalItems, 30);
  assert.equal(body.pagination.totalPages, 3);
});

test("page two is a different page, not the same cards again", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const first = await get(token, "?page=1&limit=12");
  const second = await get(token, "?page=2&limit=12");
  const firstIds = new Set(first.body.data.map((row) => row.bookmarkId));

  assert.equal(second.body.data.length, 12);
  assert.equal(
    second.body.data.some((row) => firstIds.has(row.bookmarkId)),
    false,
  );
});

test("the default order is most recently saved first", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const { body } = await get(token, "?limit=3").expect(200);
  const savedAt = body.data.map((row) => new Date(row.savedAt).getTime());

  assert.deepEqual(savedAt, [...savedAt].sort((a, b) => b - a));
});

test("the access filter runs over the whole wishlist, not over one page", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const { body } = await get(token, "?access=free&page=1&limit=2").expect(200);

  // Every third course is free.
  assert.equal(body.pagination.totalItems, 10);
  assert.equal(body.data.length, 2);
  assert.equal(
    body.data.every((row) => row.course.accessType === "free"),
    true,
  );
});

test("search matches a course that is not on the current page", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const { body } = await get(token, "?search=kubernetes&limit=50").expect(200);

  assert.equal(body.pagination.totalItems, 1);
  assert.equal(body.data[0].course.title, "Course 05");
});

test("search also matches an educator", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const { body } = await get(token, "?search=vikram&limit=50").expect(200);

  assert.ok(body.data.length > 0);
  assert.equal(
    body.data.every((row) => row.course.educator === "Vikram Nair"),
    true,
  );
});

test("a regex metacharacter in the search box is a search, not a 500", async () => {
  const { token } = await seedWishlist({ count: 5 });

  const { body } = await get(token, "?search=%28").expect(200);

  assert.equal(body.success, true);
  assert.deepEqual(body.data, []);
});

test("the category filter matches the whole category", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const { body } = await get(
    token,
    "?category=Finance%20%26%20Accounting&limit=50",
  ).expect(200);

  assert.equal(
    body.data.every((row) => row.course.category === "Finance & Accounting"),
    true,
  );
  assert.equal(body.pagination.totalItems, 10);
});

// If the dropdown shrank to the filtered set, the user could never change their
// mind after filtering once.
test("the category list stays complete while a category is filtered", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const unfiltered = await get(token, "?limit=1");
  const filtered = await get(token, "?category=IT%20%26%20Software&limit=1");

  assert.deepEqual(filtered.body.categories, unfiltered.body.categories);
  assert.equal(filtered.body.categories.length, CATEGORIES.length);
});

test("a grouped price sorts as a number, not as a string", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const { body } = await get(token, "?sort=price-desc&limit=50").expect(200);
  const prices = body.data.map((row) => row.course.numericPrice);

  assert.equal(prices[0], 1299);
  assert.deepEqual(prices, [...prices].sort((a, b) => b - a));
});

test("titles sort case-insensitively, as localeCompare did", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const { body } = await get(token, "?sort=title-asc&limit=50").expect(200);
  const titles = body.data.map((row) => row.course.title);

  assert.deepEqual(
    titles,
    [...titles].sort((a, b) => a.localeCompare(b)),
  );
});

test("a bookmark whose course was deleted stays on the wishlist", async () => {
  const { token, courses } = await seedWishlist({ count: 6 });
  await Course.deleteOne({ _id: courses[0]._id });

  const { body } = await get(token, "?limit=50").expect(200);

  assert.equal(body.pagination.totalItems, 6);

  const orphan = body.data.find(
    (row) => row.course.availability === "deleted",
  );

  assert.ok(orphan);
  assert.equal(orphan.course.title, MISSING_COURSE.title);
  assert.equal(orphan.course.id, null);
});

test("the availability filter finds exactly those rows", async () => {
  const { token, courses } = await seedWishlist({ count: 6 });
  await Course.deleteOne({ _id: courses[0]._id });

  const deleted = await get(token, "?availability=deleted&limit=50");
  const available = await get(token, "?availability=available&limit=50");

  assert.equal(deleted.body.pagination.totalItems, 1);
  assert.equal(available.body.pagination.totalItems, 5);
});

test("one student never sees another student's wishlist", async () => {
  const { token } = await seedWishlist({ count: 6 });

  const password = await bcrypt.hash("password123", 10);
  const other = await User.create({
    name: "Rahul Verma",
    email: "rahul@example.com",
    password,
    type: "student",
    isVerified: true,
  });

  const otherToken = jwt.sign({ id: other._id }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });

  assert.equal((await get(token, "?limit=50")).body.pagination.totalItems, 6);
  assert.equal(
    (await get(otherToken, "?limit=50")).body.pagination.totalItems,
    0,
  );
});

test("a page past the end returns the last page rather than nothing", async () => {
  const { token } = await seedWishlist({ count: 30 });

  const { body } = await get(token, "?page=99&limit=12").expect(200);

  assert.equal(body.pagination.page, 3);
  assert.equal(body.data.length, 6);
});

test("an empty wishlist is an empty page, not an error", async () => {
  const password = await bcrypt.hash("password123", 10);
  const student = await User.create({
    name: "New Student",
    email: "new@example.com",
    password,
    type: "student",
    isVerified: true,
  });

  const token = jwt.sign({ id: student._id }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });

  const { body } = await get(token).expect(200);

  assert.deepEqual(body.data, []);
  assert.deepEqual(body.categories, []);
  assert.equal(body.pagination.totalItems, 0);
});

// find() casts a string id against the schema; aggregate() does not, and
// getUserId returns `req.user._id.toString()`. Without an explicit cast the
// $match matches nothing and the wishlist silently reads as empty.
test("a token's string id still matches the stored ObjectId", async () => {
  const { token, student } = await seedWishlist({ count: 4 });

  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  assert.equal(typeof decoded.id, "string");
  assert.equal(decoded.id, String(student._id));

  const { body } = await get(token, "?limit=50").expect(200);

  assert.equal(body.pagination.totalItems, 4);
});

test("a bad filter is still a 400 with the old message", async () => {
  const { token } = await seedWishlist({ count: 3 });

  const { body } = await get(token, "?sort=rating").expect(400);

  assert.equal(body.success, false);
  assert.equal(body.message, "Invalid saved-course sort option.");
});

// The wishlist is a student feature; the router enforces that.
test("the endpoint still requires a signed-in student", async () => {
  await request(app).get("/api/bookmarks").expect(401);
});

test("the response keeps the shape the wishlist page reads", async () => {
  const { token } = await seedWishlist({ count: 3 });

  const { body } = await get(token, "?limit=12").expect(200);
  const [row] = body.data;

  assert.deepEqual(Object.keys(row).sort(), [
    "bookmarkId",
    "course",
    "savedAt",
  ]);

  for (const key of [
    "id",
    "title",
    "category",
    "educator",
    "description",
    "price",
    "numericPrice",
    "accessType",
    "availability",
    "enrolled",
  ]) {
    assert.ok(Object.hasOwn(row.course, key), `course.${key} is missing`);
  }

  assert.deepEqual(Object.keys(body.filters).sort(), [
    "access",
    "availability",
    "category",
    "search",
    "sort",
  ]);
});
