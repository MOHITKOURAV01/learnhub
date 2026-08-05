const { removeCourseVideoFiles } = require("../utils/courseFileCleanup");

function getAuthenticatedIdentity(req) {
  const user = req.user || {};
  const role = String(user.role || user.type || "").toLowerCase();
  const userId = String(user._id || user.id || "");

  return { role, userId };
}

function createDeleteCourseController({
  Course,
  isValidObjectId,
  cleanupFiles = removeCourseVideoFiles,
  logger = console,
} = {}) {
  return async function deleteCourseController(req, res) {
    // Load production dependencies only when mocks were not injected.
    const CourseModel = Course || require("../schemas/courseModel");
    const validateObjectId =
      isValidObjectId || require("mongoose").isValidObjectId;

    const { courseid } = req.params;
    const { role, userId } = getAuthenticatedIdentity(req);

    if (!validateObjectId(courseid)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID",
      });
    }

    if (!userId || !["teacher", "admin"].includes(role)) {
      return res.status(403).send({
        success: false,
        message: "Forbidden: Access denied",
      });
    }

    try {
      const course = await CourseModel.findById(courseid);

      if (!course) {
        return res.status(404).send({
          success: false,
          message: "Course not found",
        });
      }

      const ownerId = String(course.userId || "");
      if (role === "teacher" && ownerId !== userId) {
        return res.status(403).send({
          success: false,
          message: "You can only delete courses you own",
        });
      }

      const deleteFilter =
        role === "admin"
          ? { _id: courseid }
          : { _id: courseid, userId };

      const deletedCourse =
        await CourseModel.findOneAndDelete(deleteFilter);

      if (!deletedCourse) {
        return res.status(404).send({
          success: false,
          message: "Course not found",
        });
      }

      const cleanupResult = await cleanupFiles(deletedCourse);

      if (cleanupResult.failed.length > 0) {
        logger.warn(
          "Course deleted, but some local videos could not be removed",
          {
            courseId: courseid,
            failedFiles: cleanupResult.failed.length,
          },
        );
      }

      return res.status(200).send({
        success: true,
        message: "Course deleted successfully",
        cleanup: {
          deletedFiles: cleanupResult.deleted.length,
          failedFiles: cleanupResult.failed.length,
        },
      });
    } catch (error) {
      logger.error("Error deleting course", {
        courseId: courseid,
        message:
          error instanceof Error ? error.message : String(error),
      });

      return res.status(500).send({
        success: false,
        message: "Failed to delete course",
      });
    }
  };
}

const deleteCourseController = (req, res) =>
  createDeleteCourseController()(req, res);

module.exports = {
  createDeleteCourseController,
  deleteCourseController,
  getAuthenticatedIdentity,
};
