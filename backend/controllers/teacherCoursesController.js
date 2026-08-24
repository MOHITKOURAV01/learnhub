const { countSections } = require("../utils/courseSections");
const {
  buildCaseInsensitiveExactRegex,
  escapeRegex,
  normalizeText,
} = require("../utils/courseListing");
const {
  buildPaginationMetadata,
  normalizePagination,
} = require("../utils/pagination");

/**
 * GET /api/user/getallcoursesteacher — an educator's own courses.
 *
 * The previous implementation lived in the userControllers aggregator:
 *
 *   const allCourses = await courseSchema.find({ userId: req.body.userId });
 *   if (!allCourses) { ... }
 *
 * Three problems (#94):
 *
 *   * `req.body.userId` is the copy authMiddleware writes into the body. #83
 *     removed that coupling from /addcourse for the same reason — `req.user`
 *     is the identity a request body cannot influence.
 *   * `find()` resolves to `[]`, which is truthy, so the `!allCourses` branch
 *     was unreachable dead code.
 *   * No skip, no limit, no projection. Every course the teacher owns came
 *     back as a full document — every section's S_title, S_description and
 *     S_content.path — to render six scalars and a count.
 *
 * Every other list endpoint in this project has been paginated as it was
 * touched (#43 courses, #65 enrolments, reviews, payments, activity logs).
 * This one now matches, including the response envelope.
 */

// The columns the dashboard renders, and nothing else. Notably not `sections`:
// the client needs the count, which is computed here, not the file paths.
const COURSE_FIELDS =
  "_id C_title C_categories C_description C_price C_educator enrolled createdAt updatedAt sections";

function getTeacherId(req) {
  const user = req.user || {};
  const fromMiddleware = user._id || user.id;

  return fromMiddleware ? String(fromMiddleware) : null;
}

/**
 * Search and category filter over one educator's courses.
 *
 * `escapeRegex` matters: an unescaped search value goes straight into a RegExp
 * and a single `(` is enough to throw.
 *
 * @param {string} teacherId
 * @param {object} query
 * @returns {object} a Mongo filter
 */
function buildTeacherCourseFilter(teacherId, query = {}) {
  const filter = { userId: teacherId };

  const search = normalizeText(query.search, 120);
  if (search) {
    const searchRegex = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { C_title: { $regex: searchRegex } },
      { C_description: { $regex: searchRegex } },
    ];
  }

  const category = normalizeText(query.category, 80);
  if (category) {
    filter.C_categories = { $regex: buildCaseInsensitiveExactRegex(category) };
  }

  return filter;
}

/**
 * @param {object} query
 * @returns {object} a Mongo sort
 */
function buildTeacherCourseSort(query = {}) {
  const sort = normalizeText(query.sort, 30).toLowerCase();

  switch (sort) {
    case "title":
      return { C_title: 1, _id: 1 };

    case "enrolled":
    case "popular":
      return { enrolled: -1, _id: 1 };

    case "oldest":
      return { createdAt: 1, _id: 1 };

    case "newest":
    default:
      return { createdAt: -1, _id: -1 };
  }
}

/**
 * Shapes one course for the dashboard.
 *
 * `sectionCount` is computed through `countSections`, which copes with the
 * three shapes `course.sections` takes in this collection — an array, an
 * object map, or absent. The client used to read `course.sections.length`
 * directly, which is `undefined` for the second and a TypeError for the third,
 * and one such document blanked the whole page.
 *
 * @param {object} course a lean course document
 * @returns {object}
 */
function toCourseSummary(course = {}) {
  return {
    _id: course._id,
    C_title: course.C_title || "Untitled course",
    C_categories: course.C_categories || "",
    C_description: course.C_description || "",
    C_price: course.C_price || "free",
    C_educator: course.C_educator || "",
    enrolled: Number.isFinite(course.enrolled) ? course.enrolled : 0,
    sectionCount: countSections(course.sections),
    createdAt: course.createdAt || null,
    updatedAt: course.updatedAt || null,
  };
}

/**
 * Totals across every course the educator owns, not just the page on screen.
 *
 * `enrolled` is already on every row and there was no summary of it anywhere,
 * so an educator could not see their reach without adding the numbers up by
 * eye. One aggregation, not a second full fetch.
 *
 * @param {object} CourseModel
 * @param {object} filter
 * @returns {Promise<{courses: number, learners: number, sections: number}>}
 */
async function summarizeTeacherCourses(CourseModel, filter) {
  const [row] = await CourseModel.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        courses: { $sum: 1 },
        learners: { $sum: { $ifNull: ["$enrolled", 0] } },
      },
    },
  ]);

  return {
    courses: row?.courses || 0,
    learners: row?.learners || 0,
  };
}

function createGetTeacherCoursesController({ Course, logger = console } = {}) {
  return async function getTeacherCoursesController(req, res) {
    const CourseModel = Course || require("../schemas/courseModel");
    const teacherId = getTeacherId(req);

    if (!teacherId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    try {
      const { page, limit, skip } = normalizePagination(req.query || {});
      const filter = buildTeacherCourseFilter(teacherId, req.query || {});
      const sort = buildTeacherCourseSort(req.query || {});

      const [courses, totalItems, summary] = await Promise.all([
        CourseModel.find(filter)
          .select(COURSE_FIELDS)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        CourseModel.countDocuments(filter),
        summarizeTeacherCourses(CourseModel, filter),
      ]);

      return res.status(200).send({
        success: true,
        message: "All Courses Fetched Successfully",
        data: courses.map(toCourseSummary),
        summary,
        pagination: buildPaginationMetadata({ page, limit, totalItems }),
      });
    } catch (error) {
      logger.error("Error fetching teacher courses", {
        teacherId,
        message: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).send({
        success: false,
        message: "Failed to fetch courses",
      });
    }
  };
}

const getTeacherCoursesController = (req, res) =>
  createGetTeacherCoursesController()(req, res);

module.exports = {
  COURSE_FIELDS,
  buildTeacherCourseFilter,
  buildTeacherCourseSort,
  createGetTeacherCoursesController,
  getTeacherCoursesController,
  getTeacherId,
  summarizeTeacherCourses,
  toCourseSummary,
  // Original export name, kept so the aggregator can keep re-exporting it.
  getAllCoursesUserController: getTeacherCoursesController,
};
