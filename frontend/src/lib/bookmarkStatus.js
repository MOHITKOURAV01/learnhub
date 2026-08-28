// Saved-course status on the client.
//
// `BookmarksProvider` used to derive every filled star in the application from
// one request:
//
//   const response = await axiosInstance.get("/api/bookmarks?limit=50");
//   setBookmarkIds(new Set(ids));
//
// `GET /api/bookmarks` is paginated and `parsePositiveInteger(req.query.limit,
// 12, 50)` caps `limit` at 50, so that is page one of the wishlist and nothing
// else. Every course outside the fifty most recently saved rendered a hollow
// star, and because `toggleBookmark` reads its starting value from the same
// Set, clicking one sent an add — an upsert that changed nothing — instead of
// the remove the user asked for. There was no route through the UI that could
// un-save such a course.
//
// `GET /api/bookmarks/status?courseIds=a,b,c` has always answered exactly the
// question the star asks, for up to a hundred ids in one indexed query. It was
// never called from `frontend/`. This module is the pure half of calling it:
// which ids still need an answer, how to batch them, how to read the reply, and
// how to fold it into what is already known.
//
// The state is deliberately two sets rather than one. "Saved" and "known not to
// be saved" are different from "not asked about yet", and collapsing the last
// two is precisely the bug: an unanswered id is not an unsaved one.

// Mirrors the cap in `getBookmarkStatus` (backend/controllers/
// courseBookmarkController.js), which rejects a request carrying more than a
// hundred ids. Splitting here rather than letting the request fail keeps a long
// list from losing its tail.
export const MAX_STATUS_IDS = 100;

/**
 * The empty state: nothing known to be saved, nothing asked about yet.
 *
 * @returns {{ saved: Set<string>, resolved: Set<string> }}
 */
export function emptyStatus() {
  return { saved: new Set(), resolved: new Set() };
}

/**
 * Reduces anything a component might hand over to the string form the API uses.
 *
 * Course ids arrive as `course._id` from the catalogue, as `course.id` from the
 * wishlist, and occasionally as a Mongoose ObjectId that has survived a JSON
 * round trip as an object. Everything that cannot be a usable id comes back as
 * '' so a single guard filters them all.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCourseId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);

  // An ObjectId, or `{ _id: ... }` from a populated row.
  if (typeof value === 'object') {
    const inner = value._id ?? value.id;

    if (inner !== undefined && inner !== null && inner !== value) {
      return normalizeCourseId(inner);
    }

    const text = String(value);

    return text === '[object Object]' ? '' : text.trim();
  }

  return '';
}

/**
 * Which of `requested` still needs a lookup.
 *
 * An id is skipped when its status is already known, when a request for it is
 * already in flight, or when it repeats within the same call. Order is kept so
 * the first courses on screen are the first ones asked about.
 *
 * @param {Array<unknown>} requested
 * @param {object} [options]
 * @param {Set<string>} [options.resolved] ids whose status is already known
 * @param {Set<string>} [options.inFlight] ids already being asked about
 * @returns {string[]}
 */
export function collectPendingIds(requested, { resolved, inFlight } = {}) {
  if (!Array.isArray(requested)) return [];

  const known = resolved instanceof Set ? resolved : new Set();
  const pending = inFlight instanceof Set ? inFlight : new Set();
  const seen = new Set();
  const ids = [];

  for (const candidate of requested) {
    const id = normalizeCourseId(candidate);

    if (!id || seen.has(id) || known.has(id) || pending.has(id)) continue;

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

/**
 * Splits a list into batches the endpoint will accept.
 *
 * @param {string[]} ids
 * @param {number} [size]
 * @returns {string[][]}
 */
export function chunkIds(ids, size = MAX_STATUS_IDS) {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const limit = Number.isInteger(size) && size > 0 ? size : MAX_STATUS_IDS;
  const batches = [];

  for (let index = 0; index < ids.length; index += limit) {
    batches.push(ids.slice(index, index + limit));
  }

  return batches;
}

/**
 * The query string for one batch, or null when there is nothing to ask.
 *
 * @param {string[]} ids
 * @returns {{ courseIds: string }|null}
 */
export function buildStatusParams(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;

  const usable = ids.map(normalizeCourseId).filter(Boolean);

  if (usable.length === 0) return null;

  return { courseIds: usable.join(',') };
}

/**
 * The saved ids out of a `/api/bookmarks/status` reply.
 *
 * @param {object} payload the response body
 * @returns {string[]}
 */
export function readStatusIds(payload) {
  const rows = payload?.data;

  if (!Array.isArray(rows)) return [];

  return rows.map(normalizeCourseId).filter(Boolean);
}

/**
 * The real number of saved courses, out of a `/api/bookmarks` reply.
 *
 * The header on the wishlist used to print the size of the truncated Set while
 * the result summary a few lines below printed this, so one screen showed two
 * different counts. Both read this now.
 *
 * @param {object} payload the response body
 * @returns {number|null} null when the body carries no usable count
 */
export function readSavedTotal(payload) {
  const total = Number(payload?.pagination?.totalItems);

  if (!Number.isFinite(total) || total < 0) return null;

  return Math.floor(total);
}

/**
 * Folds one answer into what is already known.
 *
 * Both halves of the reply matter. The ids that came back are saved; the ids
 * that were asked about and did *not* come back are known not to be saved,
 * which is the distinction the old single-Set state could not express.
 *
 * @param {{ saved: Set<string>, resolved: Set<string> }} state
 * @param {object} answer
 * @param {string[]} answer.requested the ids the request carried
 * @param {string[]} answer.saved the ids the server reported as saved
 * @returns {{ saved: Set<string>, resolved: Set<string> }}
 */
export function mergeStatus(state, { requested = [], saved = [] } = {}) {
  const current = state || emptyStatus();
  const nextSaved = new Set(current.saved);
  const nextResolved = new Set(current.resolved);

  const savedIds = new Set(saved.map(normalizeCourseId).filter(Boolean));

  for (const candidate of requested) {
    const id = normalizeCourseId(candidate);

    if (!id) continue;

    nextResolved.add(id);

    if (savedIds.has(id)) nextSaved.add(id);
    else nextSaved.delete(id);
  }

  // An id the server volunteered without being asked is still an answer.
  for (const id of savedIds) {
    nextSaved.add(id);
    nextResolved.add(id);
  }

  return { saved: nextSaved, resolved: nextResolved };
}

/**
 * Records a local toggle.
 *
 * The id becomes resolved either way: the user just told us what the answer is,
 * and the optimistic update is rolled back through this same function when the
 * request fails.
 *
 * @param {{ saved: Set<string>, resolved: Set<string> }} state
 * @param {unknown} courseId
 * @param {boolean} bookmarked
 * @returns {{ saved: Set<string>, resolved: Set<string> }}
 */
export function applyToggle(state, courseId, bookmarked) {
  const current = state || emptyStatus();
  const id = normalizeCourseId(courseId);

  if (!id) return current;

  const saved = new Set(current.saved);
  const resolved = new Set(current.resolved);

  resolved.add(id);

  if (bookmarked) saved.add(id);
  else saved.delete(id);

  return { saved, resolved };
}

/**
 * Records "clear all".
 *
 * Nothing is saved afterwards, and every id already asked about keeps a known
 * answer — it is simply now a negative one. Dropping `resolved` here would send
 * the next render back to the server for answers it can already work out.
 *
 * @param {{ saved: Set<string>, resolved: Set<string> }} state
 * @returns {{ saved: Set<string>, resolved: Set<string> }}
 */
export function applyClear(state) {
  const current = state || emptyStatus();

  return { saved: new Set(), resolved: new Set(current.resolved) };
}

/**
 * Moves the saved-course total by `delta`, never below zero.
 *
 * @param {unknown} total
 * @param {number} delta
 * @returns {number}
 */
export function adjustTotal(total, delta) {
  const current = Number(total);
  const step = Number(delta);

  const base = Number.isFinite(current) && current > 0 ? Math.floor(current) : 0;
  const move = Number.isFinite(step) ? Math.trunc(step) : 0;

  return Math.max(0, base + move);
}
