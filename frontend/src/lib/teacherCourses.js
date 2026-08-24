// Reading GET /api/user/getallcoursesteacher.
//
// #94 paginated and projected that endpoint. The response is now
//
//   { success, data: [ { _id, C_title, C_categories, C_description, C_price,
//                        enrolled, sectionCount, createdAt } ],
//     summary: { courses, learners },
//     pagination: { page, limit, totalItems, totalPages, hasNextPage,
//                   hasPreviousPage } }
//
// The dashboard used to read `course.sections.length` off the raw document,
// which is `undefined` when `sections` is an object map and throws when the
// field is absent — one legacy document blanked the whole page. The count is
// computed server-side now and this module never touches `sections` at all.

export const PAGE_SIZE = 12;

// Long enough to identify a course. The old preview was `slice(0, 10)`.
export const DESCRIPTION_PREVIEW_LENGTH = 160;

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'enrolled', label: 'Most learners' },
];

const SORT_VALUES = new Set(SORT_OPTIONS.map((option) => option.value));

function toCount(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) return 0;

  return Math.floor(parsed);
}

/**
 * @param {{page?: number, search?: string, sort?: string}} state
 * @returns {object} query params for axios
 */
export function buildTeacherParams({ page = 1, search = '', sort = 'newest' } = {}) {
  const params = {
    page: Math.max(1, Math.floor(page) || 1),
    limit: PAGE_SIZE,
  };

  const trimmed = String(search || '').trim();
  if (trimmed) params.search = trimmed;

  if (SORT_VALUES.has(sort) && sort !== 'newest') params.sort = sort;

  return params;
}

/**
 * Normalises one row. Every field gets a usable default, because a blank cell
 * is a better outcome than an exception in a `.map()`.
 *
 * @param {unknown} course
 * @returns {object}
 */
export function readCourse(course) {
  const source = course && typeof course === 'object' ? course : {};

  return {
    id: source._id ? String(source._id) : '',
    title: source.C_title || 'Untitled course',
    category: source.C_categories || 'Uncategorised',
    description: source.C_description || '',
    price: source.C_price || 'free',
    enrolled: toCount(source.enrolled),
    // Computed by the server for all three shapes `sections` can take.
    sectionCount: toCount(source.sectionCount),
    createdAt: source.createdAt || null,
  };
}

/**
 * @param {unknown} payload
 * @returns {Array<object>}
 */
export function readCourses(payload) {
  const rows = payload && typeof payload === 'object' ? payload.data : null;

  if (!Array.isArray(rows)) return [];

  return rows.map(readCourse).filter((course) => course.id);
}

/**
 * @param {unknown} payload
 * @returns {{courses: number, learners: number}}
 */
export function readSummary(payload) {
  const summary = payload && typeof payload === 'object' ? payload.summary : null;

  if (!summary || typeof summary !== 'object') {
    return { courses: 0, learners: 0 };
  }

  return {
    courses: toCount(summary.courses),
    learners: toCount(summary.learners),
  };
}

/**
 * Truncates on a word boundary rather than mid-word.
 *
 * @param {string} description
 * @param {boolean} expanded
 * @returns {{text: string, truncated: boolean}}
 */
export function previewDescription(description, expanded = false) {
  const text = String(description || '');

  if (expanded || text.length <= DESCRIPTION_PREVIEW_LENGTH) {
    return { text, truncated: false };
  }

  const cut = text.slice(0, DESCRIPTION_PREVIEW_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > DESCRIPTION_PREVIEW_LENGTH / 2 ? cut.slice(0, lastSpace) : cut;

  return { text: `${trimmed.trimEnd()}…`, truncated: true };
}

/**
 * @param {number} sectionCount
 * @returns {string}
 */
export function describeSections(sectionCount) {
  if (sectionCount === 0) return 'No sections yet';

  return sectionCount === 1 ? '1 section' : `${sectionCount} sections`;
}

/**
 * @param {number} enrolled
 * @returns {string}
 */
export function describeEnrolled(enrolled) {
  if (enrolled === 0) return 'No learners yet';

  return enrolled === 1 ? '1 learner' : `${enrolled} learners`;
}

/**
 * @param {{courses: number, learners: number}} summary
 * @returns {string}
 */
export function describeSummary(summary) {
  const courses = summary?.courses || 0;
  const learners = summary?.learners || 0;

  if (courses === 0) return 'You have not published a course yet';

  const coursePart = courses === 1 ? '1 published course' : `${courses} published courses`;

  return `${coursePart} · ${describeEnrolled(learners)}`;
}

/**
 * @param {unknown} value an ISO date string
 * @returns {string}
 */
export function formatPublishedDate(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Describes the slice on screen, for the range line under the grid.
 *
 * @param {object} pagination
 * @param {number} rowCount
 * @returns {string}
 */
export function describeTeacherRange(pagination, rowCount) {
  const totalItems = toCount(pagination?.totalItems);

  if (totalItems === 0 || rowCount === 0) return 'No courses to show';

  const limit = toCount(pagination?.limit) || PAGE_SIZE;
  const page = Math.max(1, toCount(pagination?.page) || 1);
  const first = (page - 1) * limit + 1;
  const last = Math.min(first + rowCount - 1, totalItems);

  return `Showing ${first}–${last} of ${totalItems} courses`;
}
