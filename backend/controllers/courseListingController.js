const {
  buildPaginationMetadata,
  normalizePagination,
} = require("../utils/pagination");
const {
  buildCourseFilter,
  buildCourseSort,
} = require("../utils/courseListing");
const { toPublicCourses } = require("../utils/publicCourse");

function createGetAllCoursesController({
  Course,
  logger = console,
} = {}) {
  return async function getAllCoursesController(req, res) {
    const CourseModel = Course || require("../schemas/courseModel");

    try {
      const { page, limit, skip } = normalizePagination(req.query || {});
      const filter = buildCourseFilter(req.query || {});
      const sort = buildCourseSort(req.query || {});

      const [allCourses, totalItems] = await Promise.all([
        CourseModel.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        CourseModel.countDocuments(filter),
      ]);

      return res.status(200).send({
        success: true,
        // Preserve the existing response field used by current consumers.
        // `sections` is stripped: this route is unauthenticated, and each
        // section carried the storage path of its video.
        data: toPublicCourses(allCourses),
        pagination: buildPaginationMetadata({
          page,
          limit,
          totalItems,
        }),
      });
    } catch (error) {
      logger.error("Error fetching courses:", error);

      return res.status(500).send({
        success: false,
        message: "Failed to fetch courses",
      });
    }
  };
}

const getAllCoursesController = (req, res) =>
  createGetAllCoursesController()(req, res);

module.exports = {
  createGetAllCoursesController,
  getAllCoursesController,
};
