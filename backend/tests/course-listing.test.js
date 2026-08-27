const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildPaginationMetadata,
  normalizePagination,
} = require("../utils/pagination");
const {
  FREE_PRICE_PATTERN,
  buildCourseFilter,
  buildCourseSort,
  escapeRegex,
} = require("../utils/courseListing");
const {
  createGetAllCoursesController,
} = require("../controllers/courseListingController");

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function createCourseModel({
  courses = [],
  totalItems = courses.length,
} = {}) {
  const calls = {
    find: [],
    sort: [],
    skip: [],
    limit: [],
    countDocuments: [],
  };

  const chain = {
    sort(value) {
      calls.sort.push(value);
      return this;
    },
    skip(value) {
      calls.skip.push(value);
      return this;
    },
    limit(value) {
      calls.limit.push(value);
      return this;
    },
    async lean() {
      return courses;
    },
  };

  return {
    calls,
    find(filter) {
      calls.find.push(filter);
      return chain;
    },
    async countDocuments(filter) {
      calls.countDocuments.push(filter);
      return totalItems;
    },
  };
}

test("pagination defaults to page 1 and limit 12", () => {
  assert.deepEqual(normalizePagination({}), {
    page: 1,
    limit: DEFAULT_LIMIT,
    skip: 0,
  });
});

test("pagination safely normalizes malformed and negative values", () => {
  assert.deepEqual(
    normalizePagination({
      page: "-5",
      limit: "not-a-number",
    }),
    {
      page: 1,
      limit: DEFAULT_LIMIT,
      skip: 0,
    },
  );
});

test("pagination caps oversized limits at 100", () => {
  assert.deepEqual(
    normalizePagination({
      page: "3",
      limit: "9999",
    }),
    {
      page: 3,
      limit: MAX_LIMIT,
      skip: 200,
    },
  );
});

test("pagination metadata reports navigation correctly", () => {
  assert.deepEqual(
    buildPaginationMetadata({
      page: 2,
      limit: 12,
      totalItems: 30,
    }),
    {
      page: 2,
      limit: 12,
      totalItems: 30,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    },
  );
});

test("empty results return zero total pages", () => {
  assert.deepEqual(
    buildPaginationMetadata({
      page: 1,
      limit: 12,
      totalItems: 0,
    }),
    {
      page: 1,
      limit: 12,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  );
});

test("search escapes regular-expression metacharacters", () => {
  assert.equal(
    escapeRegex("node.js (beginner)+"),
    "node\\.js \\(beginner\\)\\+",
  );

  const filter = buildCourseFilter({
    search: "node.js",
  });

  const titleRegex = filter.$or[0].C_title.$regex;
  assert.equal(titleRegex.source, "node\\.js");
  assert.equal(titleRegex.flags, "i");
});

test("search targets title and description", () => {
  const filter = buildCourseFilter({
    search: "javascript",
  });

  assert.equal(filter.$or.length, 2);
  assert.ok(filter.$or[0].C_title);
  assert.ok(filter.$or[1].C_description);
});

test("category and educator filters are exact and case-insensitive", () => {
  const filter = buildCourseFilter({
    category: "Programming",
    educator: "Jane Doe",
  });

  assert.equal(
    filter.C_categories.$regex.test("programming"),
    true,
  );
  assert.equal(
    filter.C_categories.$regex.test("Programming Basics"),
    false,
  );
  assert.equal(
    filter.C_educator.$regex.test("jane doe"),
    true,
  );
});

test("free price filter supports free and zero values", () => {
  // The clause used to be a single `C_price: { $regex }`, and this test read
  // the pattern straight off it. A regex cannot match a field that does not
  // exist, and an absent price is free (#114), so the free side is an $or over
  // four clauses now. What it *selects* is unchanged for every value this test
  // already covered — asserted through the pattern rather than the shape.
  const filter = buildCourseFilter({ priceType: "free" });
  const clauses = filter.$and[0].$or;

  const matches = (price) =>
    clauses.some((clause) => clause.C_price?.$regex?.test(price));

  assert.equal(matches("free"), true);
  assert.equal(matches("FREE"), true);
  assert.equal(matches("0"), true);
  assert.equal(matches("0.00"), true);
  assert.equal(matches("29"), false);
});

test("free price filter also selects a course with no price at all", () => {
  // The half a regex could never express. `C_price` has no `required` on
  // courseModel, so both shapes are reachable, and the catalogue used to call
  // them paid while checkout enrolled them for free.
  const clauses = buildCourseFilter({ priceType: "free" }).$and[0].$or;

  assert.ok(clauses.some((clause) => clause.C_price?.$exists === false));
  assert.ok(clauses.some((clause) => clause.C_price === null));
});

test("the free filter leaves a search term's $or alone", () => {
  // Both used to want the top-level `$or`. Free is nested under `$and` so a
  // search for "css" restricted to free courses is not silently widened to
  // every free course.
  const filter = buildCourseFilter({ priceType: "free", search: "css" });

  assert.equal(filter.$or.length, 2);
  assert.ok(filter.$or.every((clause) => clause.C_title || clause.C_description));
  assert.equal(filter.$and.length, 1);
  assert.ok(filter.$and[0].$or);
});

test("paid price filter excludes the free price pattern", () => {
  const filter = buildCourseFilter({
    priceType: "paid",
  });

  assert.equal(filter.$and.length, 3);
  assert.equal(filter.$and[2].C_price.$not, FREE_PRICE_PATTERN);
});

test("sort supports newest, title, and enrollment count", () => {
  assert.deepEqual(buildCourseSort({ sort: "newest" }), {
    createdAt: -1,
    _id: -1,
  });

  assert.deepEqual(buildCourseSort({ sort: "title" }), {
    C_title: 1,
    _id: 1,
  });

  assert.deepEqual(buildCourseSort({ sort: "enrollment" }), {
    enrolled: -1,
    _id: 1,
  });
});

test("unknown sort values safely fall back to newest", () => {
  assert.deepEqual(buildCourseSort({ sort: "unexpected" }), {
    createdAt: -1,
    _id: -1,
  });
});

test("controller applies filters, sorting, skip and limit", async () => {
  const Course = createCourseModel({
    courses: [{ C_title: "JavaScript" }],
    totalItems: 25,
  });

  const controller = createGetAllCoursesController({
    Course,
    logger: {
      error() {},
    },
  });

  const req = {
    query: {
      page: "2",
      limit: "10",
      search: "javascript",
      category: "Programming",
      educator: "Jane Doe",
      priceType: "paid",
      sort: "enrollment",
    },
  };
  const res = createResponse();

  await controller(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Course.calls.skip[0], 10);
  assert.equal(Course.calls.limit[0], 10);
  assert.deepEqual(Course.calls.sort[0], {
    enrolled: -1,
    _id: 1,
  });
  assert.equal(Course.calls.find.length, 1);
  assert.deepEqual(
    Course.calls.countDocuments[0],
    Course.calls.find[0],
  );
});

test("controller preserves data array and adds pagination metadata", async () => {
  const courses = [
    {
      _id: "course-1",
      C_title: "Course One",
    },
  ];
  const Course = createCourseModel({
    courses,
    totalItems: 13,
  });
  const controller = createGetAllCoursesController({
    Course,
    logger: {
      error() {},
    },
  });
  const res = createResponse();

  await controller(
    {
      query: {
        page: "1",
        limit: "12",
      },
    },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, courses);
  assert.deepEqual(res.body.pagination, {
    page: 1,
    limit: 12,
    totalItems: 13,
    totalPages: 2,
    hasNextPage: true,
    hasPreviousPage: false,
  });
});

test("controller returns an empty array rather than 404", async () => {
  const Course = createCourseModel({
    courses: [],
    totalItems: 0,
  });
  const controller = createGetAllCoursesController({
    Course,
    logger: {
      error() {},
    },
  });
  const res = createResponse();

  await controller({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, []);
  assert.equal(res.body.pagination.totalItems, 0);
});

test("controller returns a controlled 500 response on database failure", async () => {
  const Course = {
    find() {
      throw new Error("database unavailable");
    },
  };
  const controller = createGetAllCoursesController({
    Course,
    logger: {
      error() {},
    },
  });
  const res = createResponse();

  await controller({ query: {} }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    success: false,
    message: "Failed to fetch courses",
  });
});
