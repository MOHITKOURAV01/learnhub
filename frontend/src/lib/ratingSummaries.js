// Rating summaries on the client.
//
// CourseRatingBadge fetched its own summary in a useEffect, so a catalogue page
// of twelve cards issued twelve requests on top of the one for the courses, and
// another burst every time the result set changed. The API now answers for a
// whole page at once; this is the pure half of talking to it.

export const EMPTY_SUMMARY = Object.freeze({
  averageRating: 0,
  totalReviews: 0,
});

// Mirrors MAX_SUMMARY_IDS in backend/utils/reviewSummaries.js. Splitting here
// rather than letting the server silently truncate keeps the last few cards on
// an unusually long list from quietly showing "New".
export const MAX_SUMMARY_IDS = 60;

/**
 * Pulls the ids worth asking about out of a list of rows.
 *
 * De-duplicated, because the same course can legitimately appear twice in a
 * list, and capped to what the endpoint accepts.
 *
 * @param {Array<{ _id?: string }>} rows
 * @param {object} [options]
 * @param {number} [options.max]
 * @returns {string[]}
 */
export function collectCourseIds(rows, { max = MAX_SUMMARY_IDS } = {}) {
  if (!Array.isArray(rows)) return [];

  const ids = [];
  const seen = new Set();

  for (const row of rows) {
    const id = row?._id ? String(row._id) : '';

    if (!id || seen.has(id)) continue;

    seen.add(id);
    ids.push(id);

    if (ids.length >= max) break;
  }

  return ids;
}

/**
 * Normalises one summary from the API.
 *
 * A badge renders whatever it is handed, so a malformed or partial entry has to
 * come out as a valid zero rather than as `NaN stars`.
 *
 * @param {unknown} summary
 * @returns {{ averageRating: number, totalReviews: number }}
 */
export function normalizeSummary(summary) {
  const average = Number(summary?.averageRating);
  const total = Number(summary?.totalReviews);

  return {
    averageRating: Number.isFinite(average) && average > 0 ? average : 0,
    totalReviews: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0,
  };
}

/**
 * Turns the `{ [courseId]: summary }` block into a Map, normalising as it goes.
 *
 * @param {object} payload the response body
 * @returns {Map<string, { averageRating: number, totalReviews: number }>}
 */
export function readSummaryMap(payload) {
  const block = payload?.data;
  const summaries = new Map();

  if (!block || typeof block !== 'object') return summaries;

  for (const [courseId, summary] of Object.entries(block)) {
    summaries.set(String(courseId), normalizeSummary(summary));
  }

  return summaries;
}

/**
 * The query for the batch endpoint, or null when there is nothing to ask.
 *
 * @param {string[]} courseIds
 * @returns {{ courseIds: string }|null}
 */
export function buildSummaryParams(courseIds) {
  if (!Array.isArray(courseIds) || courseIds.length === 0) return null;

  return { courseIds: courseIds.join(',') };
}
