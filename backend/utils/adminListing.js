// Query building for the admin dashboard's list endpoints.
//
// Every list endpoint in this project has been paginated as it was touched —
// #43 for the catalogue, #65 for enrolments, and reviews, payments and activity
// logs when they were written. The three the admin dashboard depends on were
// not:
//
//   userSchema.find().select(PUBLIC_USER_PROJECTION)
//   courseSchema.find()
//   enrolledCourseSchema.find().populate(...).populate(...)
//
// No skip, no limit, no filter, no sort. At a few hundred rows this is a slow
// page; nothing in the code makes it stop being one at a few hundred thousand
// (#96).
//
// The course rules are deliberately the ones the public catalogue already uses
// — buildCourseFilter and buildCourseSort from utils/courseListing — so an
// admin searching for a course and a visitor searching for one get the same
// answers. Only the user rules are new.

const {
  escapeRegex,
  normalizeText,
} = require("./courseListing");

const ROLE_VALUES = new Set(["student", "teacher", "admin"]);

const VERIFIED_VALUES = {
  verified: true,
  unverified: false,
};

/**
 * Search, role and verification filter for the users table.
 *
 * `escapeRegex` is not optional: an unescaped search value goes straight into
 * a RegExp, and a single `(` throws — which would surface as a 500 on a search
 * box.
 *
 * @param {object} [query]
 * @returns {object} a Mongo filter
 */
function buildUserFilter(query = {}) {
  const filter = {};

  const search = normalizeText(query.search, 120);
  if (search) {
    const searchRegex = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { name: { $regex: searchRegex } },
      { email: { $regex: searchRegex } },
    ];
  }

  const role = normalizeText(query.role, 20).toLowerCase();
  if (ROLE_VALUES.has(role)) {
    filter.type = role;
  }

  const verified = normalizeText(query.verified, 20).toLowerCase();
  if (Object.hasOwn(VERIFIED_VALUES, verified)) {
    filter.isVerified = VERIFIED_VALUES[verified];
  }

  return filter;
}

/**
 * @param {object} [query]
 * @returns {object} a Mongo sort, always with a stable tiebreak
 */
function buildUserSort(query = {}) {
  const sort = normalizeText(query.sort, 30).toLowerCase();

  switch (sort) {
    case "name":
      return { name: 1, _id: 1 };

    case "email":
      return { email: 1, _id: 1 };

    case "role":
      return { type: 1, name: 1, _id: 1 };

    case "oldest":
      return { createdAt: 1, _id: 1 };

    case "newest":
    default:
      return { createdAt: -1, _id: -1 };
  }
}

/**
 * The columns the admin course table renders.
 *
 * Notably absent: `sections`. The old endpoint returned the full document, so
 * every section's S_title, S_description and S_content.path went to the
 * browser to render six scalars and a count. Those paths are the same ones #76
 * is about.
 */
const ADMIN_COURSE_FIELDS =
  "_id C_title C_educator C_categories C_price enrolled userId createdAt sections";

/**
 * Shapes one course row. `countSections` is applied by the caller, which owns
 * the import, so this module stays free of schema knowledge.
 *
 * @param {object} course a lean course document
 * @param {(sections: unknown) => number} countSections
 * @returns {object}
 */
function toAdminCourseRow(course = {}, countSections) {
  return {
    _id: course._id,
    C_title: course.C_title || "Untitled course",
    C_educator: course.C_educator || "Unknown educator",
    C_categories: course.C_categories || "",
    C_price: course.C_price || "free",
    enrolled: Number.isFinite(course.enrolled) ? course.enrolled : 0,
    sectionCount: countSections(course.sections),
    createdAt: course.createdAt || null,
  };
}

/**
 * Shapes one enrolment row for the admin table.
 *
 * `populate` resolves a reference that no longer exists to `null`, which is
 * how the dashboard ended up rendering rows with a blank name and a blank
 * course title. Say so instead.
 *
 * @param {object} enrollment a lean enrolment document
 * @returns {object}
 */
function toAdminEnrollmentRow(enrollment = {}) {
  const user = enrollment.userId;
  const course = enrollment.courseId;

  return {
    _id: enrollment._id,
    user: user
      ? { _id: user._id, name: user.name, email: user.email }
      : null,
    course: course ? { _id: course._id, C_title: course.C_title } : null,
    courseLength: Number.isFinite(enrollment.course_Length)
      ? enrollment.course_Length
      : 0,
    completed: Array.isArray(enrollment.progress)
      ? enrollment.progress.length
      : 0,
    certificateDate: enrollment.certificateDate || null,
    enrolledAt: enrollment.createdAt || null,
    // A row whose user or course has been deleted is flagged rather than
    // rendered as two blank cells.
    orphaned: !user || !course,
  };
}

module.exports = {
  ADMIN_COURSE_FIELDS,
  ROLE_VALUES,
  buildUserFilter,
  buildUserSort,
  toAdminCourseRow,
  toAdminEnrollmentRow,
};
