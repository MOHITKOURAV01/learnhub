const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const request = require("supertest");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

const {
  MAX_SUMMARY_IDS,
  buildSummaryMap,
  buildSummaryPipeline,
  formatSummaryRow,
  normalizeCourseIds,
} = require("../utils/reviewSummaries");

// CourseRatingBadge called GET /api/reviews/:courseId/summary once per card, so
// a twelve-card catalogue page ran twelve independent aggregations over
// courseReviews — including for the ten courses with no reviews at all. The
// same $group keyed by courseId answers the whole page in one indexed pass.

const idA = "64b7f1e2c3d4e5f607182930";
const idB = "64b7f1e2c3d4e5f607182931";
const idC = "64b7f1e2c3d4e5f607182932";

// -- id normalisation --------------------------------------------------------

test("a comma separated list becomes a list of ids", () => {
  assert.deepEqual(normalizeCourseIds(`${idA},${idB}`), [idA, idB]);
});

test("an array is accepted as well as a string", () => {
  assert.deepEqual(normalizeCourseIds([idA, idB]), [idA, idB]);
});

test("ids that are not ObjectIds are dropped, not rejected", () => {
  // One bad id in a list of twelve should not fail the whole page.
  assert.deepEqual(normalizeCourseIds(`${idA},not-an-id,,${idB}`), [idA, idB]);
});

test("duplicates are collapsed so the same course is not counted twice", () => {
  assert.deepEqual(normalizeCourseIds(`${idA},${idA},${idB}`), [idA, idB]);
});

test("the list is capped", () => {
  const many = Array.from({ length: MAX_SUMMARY_IDS + 20 }, () =>
    String(new mongoose.Types.ObjectId()),
  );

  assert.equal(normalizeCourseIds(many).length, MAX_SUMMARY_IDS);
});

test("an empty or missing list is an empty list", () => {
  assert.deepEqual(normalizeCourseIds(undefined), []);
  assert.deepEqual(normalizeCourseIds(""), []);
  assert.deepEqual(normalizeCourseIds("   "), []);
});

// -- shaping -----------------------------------------------------------------

test("the pipeline matches every requested id in one stage", () => {
  const [match, group] = buildSummaryPipeline([idA, idB]);

  assert.equal(match.$match.courseId.$in.length, 2);
  assert.equal(group.$group._id, "$courseId");
});

test("an average is rounded to one decimal place", () => {
  const summary = formatSummaryRow({
    _id: idA,
    averageRating: 4.333333,
    totalReviews: 3,
    fourStar: 2,
    fiveStar: 1,
  });

  assert.equal(summary.averageRating, 4.3);
  assert.equal(summary.totalReviews, 3);
  assert.deepEqual(summary.distribution, { 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 });
});

test("a course with no reviews still gets an entry in the map", () => {
  // The client should not have to tell "no reviews yet" apart from "this id was
  // missing from the response".
  const summaries = buildSummaryMap(
    [idA, idB],
    [{ _id: idA, averageRating: 5, totalReviews: 1, fiveStar: 1 }],
  );

  assert.equal(summaries[idA].totalReviews, 1);
  assert.deepEqual(summaries[idB], {
    averageRating: 0,
    totalReviews: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  });
});

test("each empty summary is its own object", () => {
  const summaries = buildSummaryMap([idA, idB], []);

  summaries[idA].totalReviews = 99;

  assert.equal(summaries[idB].totalReviews, 0);
});

// -- through the route -------------------------------------------------------

let app;
let CourseReview;

function buildReviewApp() {
  const instance = express();

  instance.use(express.json());
  instance.use("/api/reviews", require("../routers/courseReviewRoutes"));

  return instance;
}

test.before(async () => {
  await startTestDatabase();
  app = buildReviewApp();
  CourseReview = require("../schemas/courseReviewModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

async function seedReviews() {
  await CourseReview.create([
    { userId: new mongoose.Types.ObjectId(), courseId: idA, rating: 5 },
    { userId: new mongoose.Types.ObjectId(), courseId: idA, rating: 4 },
    { userId: new mongoose.Types.ObjectId(), courseId: idB, rating: 3 },
  ]);
}

test("one request answers for a whole page of courses", async () => {
  await seedReviews();

  const res = await request(app)
    .get("/api/reviews/summaries")
    .query({ courseIds: [idA, idB, idC].join(",") });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);

  assert.equal(res.body.data[idA].averageRating, 4.5);
  assert.equal(res.body.data[idA].totalReviews, 2);
  assert.equal(res.body.data[idB].averageRating, 3);
  // idC has no reviews and is still present.
  assert.equal(res.body.data[idC].totalReviews, 0);
});

test("the batch route is not shadowed by GET /:courseId", async () => {
  // "summaries" is a valid path segment and would otherwise be read as a
  // course id, which validateCourseId rejects with a 400.
  const res = await request(app).get("/api/reviews/summaries");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, {});
});

test("the batch and single endpoints report the same numbers", async () => {
  await seedReviews();

  const batch = await request(app)
    .get("/api/reviews/summaries")
    .query({ courseIds: idA });
  const single = await request(app).get(`/api/reviews/${idA}/summary`);

  assert.deepEqual(batch.body.data[idA], single.body.data);
});

test("an unusable id list does not fail the request", async () => {
  await seedReviews();

  const res = await request(app)
    .get("/api/reviews/summaries")
    .query({ courseIds: `nonsense,,${idA}` });

  assert.equal(res.status, 200);
  assert.equal(res.body.requested, 1);
  assert.equal(res.body.data[idA].totalReviews, 2);
});
