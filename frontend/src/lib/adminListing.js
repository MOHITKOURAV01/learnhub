// Reading the admin dashboard's paginated list endpoints (#96).
//
// `/api/admin/getallusers` and `/api/admin/getallcourses` used to return every
// row in the collection and the tables rendered every one of them. Both are
// paginated now, both accept a server-side search, and the course rows carry a
// `sectionCount` in place of the `sections` array — the table renders a count,
// and the raw field carries every section's file path.

export const PAGE_SIZE = 20;

export const USER_ROLE_OPTIONS = [
  { value: '', label: 'All roles' },
  { value: 'student', label: 'Students' },
  { value: 'teacher', label: 'Educators' },
  { value: 'admin', label: 'Admins' },
];

export const USER_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'email', label: 'Email A–Z' },
  { value: 'role', label: 'Role' },
];

export const COURSE_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'enrollment', label: 'Most enrolled' },
];

const USER_SORTS = new Set(USER_SORT_OPTIONS.map((option) => option.value));
const COURSE_SORTS = new Set(COURSE_SORT_OPTIONS.map((option) => option.value));
const ROLES = new Set(['student', 'teacher', 'admin']);

function toCount(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) return 0;

  return Math.floor(parsed);
}

function basePage(page) {
  return Math.max(1, Math.floor(page) || 1);
}

/**
 * @param {{page?: number, search?: string, role?: string, sort?: string}} state
 * @returns {object}
 */
export function buildUserParams({ page = 1, search = '', role = '', sort = 'newest' } = {}) {
  const params = { page: basePage(page), limit: PAGE_SIZE };

  const trimmed = String(search || '').trim();
  if (trimmed) params.search = trimmed;

  if (ROLES.has(role)) params.role = role;

  if (USER_SORTS.has(sort) && sort !== 'newest') params.sort = sort;

  return params;
}

/**
 * @param {{page?: number, search?: string, priceType?: string, sort?: string}} state
 * @returns {object}
 */
export function buildCourseParams({
  page = 1,
  search = '',
  priceType = '',
  sort = 'newest',
} = {}) {
  const params = { page: basePage(page), limit: PAGE_SIZE };

  const trimmed = String(search || '').trim();
  if (trimmed) params.search = trimmed;

  if (priceType === 'free' || priceType === 'paid') params.priceType = priceType;

  if (COURSE_SORTS.has(sort) && sort !== 'newest') params.sort = sort;

  return params;
}

/**
 * @param {unknown} user
 * @returns {object}
 */
export function readUser(user) {
  const source = user && typeof user === 'object' ? user : {};

  return {
    id: source._id ? String(source._id) : '',
    name: source.name || 'Unnamed account',
    email: source.email || '—',
    role: String(source.type || '').toLowerCase() || 'unknown',
    verified: Boolean(source.isVerified),
    createdAt: source.createdAt || null,
  };
}

/**
 * @param {unknown} payload
 * @returns {Array<object>}
 */
export function readUsers(payload) {
  const rows = payload && typeof payload === 'object' ? payload.data : null;

  if (!Array.isArray(rows)) return [];

  return rows.map(readUser).filter((user) => user.id);
}

/**
 * @param {unknown} course
 * @returns {object}
 */
export function readAdminCourse(course) {
  const source = course && typeof course === 'object' ? course : {};

  return {
    id: source._id ? String(source._id) : '',
    title: source.C_title || 'Untitled course',
    educator: source.C_educator || 'Unknown educator',
    category: source.C_categories || 'Uncategorised',
    price: source.C_price || 'free',
    enrolled: toCount(source.enrolled),
    // Computed server-side. The table used to read `Course.sections.length`,
    // which is `undefined` for an object-shaped field and a TypeError when the
    // field is absent.
    sectionCount: toCount(source.sectionCount),
    createdAt: source.createdAt || null,
  };
}

/**
 * @param {unknown} payload
 * @returns {Array<object>}
 */
export function readAdminCourses(payload) {
  const rows = payload && typeof payload === 'object' ? payload.data : null;

  if (!Array.isArray(rows)) return [];

  return rows.map(readAdminCourse).filter((course) => course.id);
}

/**
 * @param {unknown} payload
 * @returns {{total: number, student: number, teacher: number, admin: number}}
 */
export function readRoleSummary(payload) {
  const summary = payload && typeof payload === 'object' ? payload.summary : null;

  if (!summary || typeof summary !== 'object') {
    return { total: 0, student: 0, teacher: 0, admin: 0 };
  }

  return {
    total: toCount(summary.total),
    student: toCount(summary.student),
    teacher: toCount(summary.teacher),
    admin: toCount(summary.admin),
  };
}

/**
 * @param {{total: number, student: number, teacher: number, admin: number}} summary
 * @returns {string}
 */
export function describeRoleSummary(summary) {
  const total = summary?.total || 0;

  if (total === 0) return 'No accounts yet';

  const parts = [`${total} ${total === 1 ? 'account' : 'accounts'}`];

  if (summary.student) parts.push(`${summary.student} students`);
  if (summary.teacher) parts.push(`${summary.teacher} educators`);
  if (summary.admin) parts.push(`${summary.admin} admins`);

  return parts.join(' · ');
}

/**
 * @param {object} pagination
 * @param {number} rowCount
 * @param {string} [noun]
 * @returns {string}
 */
export function describeAdminRange(pagination, rowCount, noun = 'rows') {
  const totalItems = toCount(pagination?.totalItems);

  if (totalItems === 0 || rowCount === 0) return `No ${noun} to show`;

  const limit = toCount(pagination?.limit) || PAGE_SIZE;
  const page = Math.max(1, toCount(pagination?.page) || 1);
  const first = (page - 1) * limit + 1;
  const last = Math.min(first + rowCount - 1, totalItems);

  return `Showing ${first}–${last} of ${totalItems} ${noun}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function formatAdminDate(value) {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
