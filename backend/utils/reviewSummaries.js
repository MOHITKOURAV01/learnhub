// Rating summaries, for one course or for a page of them.
//
// `getSummary` ran a `$match` on a single courseId followed by a `$group`, and
// `GET /api/reviews/:courseId/summary` is called once per card by
// CourseRatingBadge. A catalogue page holds twelve cards, so opening the home
// page issued twelve independent aggregations over `courseReviews` — including
// for the courses that have no reviews at all, which is most of them.
//
// The same `$group` keyed by courseId answers the whole page in one indexed
// pass: `courseReviewSchema` already indexes { courseId: 1, createdAt: -1 }.

const mongoose = require("mongoose");

// Enough for a catalogue page (12) or a generous saved-courses list, with room
// to spare. The ids come from the client, so the list needs a ceiling.
const MAX_SUMMARY_IDS = 60;

const EMPTY_SUMMARY = Object.freeze({
  averageRating: 0,
  totalReviews: 0,
  distribution: Object.freeze({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }),
});

/**
 * A fresh empty summary. `EMPTY_SUMMARY` is frozen and shared, so anything that
 * might be mutated downstream gets a copy instead.
 */
function emptySummary() {
  return {
    averageRating: 0,
    totalReviews: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };
}

/**
 * Accepts a comma separated list or an array, and returns the ids worth
 * querying: valid ObjectIds, de-duplicated, capped.
 *
 * Anything unusable is dropped rather than rejected. A single bad id in a list
 * of twelve should not fail the whole page — the caller gets an empty summary
 * for it, which is what it would have got anyway.
 *
 * @param {string|string[]} raw
 * @param {object} [options]
 * @param {number} [options.max]
 * @returns {string[]}
 */
function normalizeCourseIds(raw, { max = MAX_SUMMARY_IDS } = {}) {
  const candidates = Array.isArray(raw)
    ? raw
    : String(raw ?? "").split(",");

  const seen = new Set();

  for (const candidate of candidates) {
    const id = String(candidate ?? "").trim();

    if (!id || seen.has(id)) continue;
    if (!mongoose.Types.ObjectId.isValid(id)) continue;

    seen.add(id);

    if (seen.size >= max) break;
  }

  return [...seen];
}

/**
 * The aggregation used by both the single and the batch path, so the numbers
 * cannot drift apart between them.
 *
 * @param {string[]} courseIds
 * @returns {object[]} a Mongo aggregation pipeline
 */
function buildSummaryPipeline(courseIds) {
  const objectIds = courseIds.map((id) => new mongoose.Types.ObjectId(id));

  return [
    { $match: { courseId: { $in: objectIds } } },
    {
      $group: {
        _id: "$courseId",
        averageRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
        oneStar: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
        twoStar: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
        threeStar: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
        fourStar: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
        fiveStar: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
      },
    },
  ];
}

/**
 * Shapes one aggregation row into the response body the client already reads.
 *
 * @param {object} row
 * @returns {{ averageRating: number, totalReviews: number, distribution: object }}
 */
function formatSummaryRow(row) {
  if (!row) return emptySummary();

  return {
    averageRating: Number((row.averageRating || 0).toFixed(1)),
    totalReviews: row.totalReviews || 0,
    distribution: {
      1: row.oneStar || 0,
      2: row.twoStar || 0,
      3: row.threeStar || 0,
      4: row.fourStar || 0,
      5: row.fiveStar || 0,
    },
  };
}

/**
 * Turns the aggregation output into `{ [courseId]: summary }`, with an explicit
 * empty summary for every requested course that has no reviews.
 *
 * Filling in the misses matters: the client should not have to tell "no reviews
 * yet" apart from "this id was not in the response".
 *
 * @param {string[]} courseIds the ids that were asked for
 * @param {object[]} rows aggregation output
 * @returns {object}
 */
function buildSummaryMap(courseIds, rows) {
  const byId = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      String(row._id),
      formatSummaryRow(row),
    ]),
  );

  const summaries = {};

  for (const id of courseIds) {
    summaries[id] = byId.get(id) || emptySummary();
  }

  return summaries;
}

module.exports = {
  EMPTY_SUMMARY,
  MAX_SUMMARY_IDS,
  buildSummaryMap,
  buildSummaryPipeline,
  emptySummary,
  formatSummaryRow,
  normalizeCourseIds,
};
