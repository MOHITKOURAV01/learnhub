const {
  buildProgressSummary,
  describeSections,
  isEnrollmentComplete,
} = require("../utils/courseProgress");

/**
 * GET /api/user/coursecontent/:courseid — the course player.
 *
 * The previous implementation lived in the userControllers aggregator and:
 *
 *   * filtered the enrolment on `req.body.userId`, the copy authMiddleware
 *     writes into the body rather than the identity on `req.user`;
 *   * answered 404 "User not found" when the caller exists and is simply not
 *     enrolled, so a legitimate access denial read as a missing account;
 *   * sent the whole enrolment document back as `certficateData` when the page
 *     used one field of it;
 *   * returned `course.sections` raw and left the client to work out how much
 *     of the course was finished — which it did with
 *     `completedModule.length === courseContent.length`, a comparison that is
 *     wrong in both directions (#93).
 *
 * The progress summary is computed here, from the same helpers My Courses
 * uses, so the two pages cannot disagree about the same enrolment.
 */

function getRequestingUserId(req) {
  const user = req.user || {};
  const fromMiddleware = user._id || user.id;

  if (fromMiddleware) {
    return String(fromMiddleware);
  }

  return req.body?.userId ? String(req.body.userId) : null;
}

function createGetCourseContentController({
  Course,
  EnrolledCourse,
  isValidObjectId,
  logger = console,
} = {}) {
  return async function getCourseContentController(req, res) {
    const CourseModel = Course || require("../schemas/courseModel");
    const EnrolledCourseModel =
      EnrolledCourse || require("../schemas/enrolledCourseModel");
    const validateObjectId =
      isValidObjectId || require("mongoose").isValidObjectId;

    const { courseid } = req.params || {};
    const userId = getRequestingUserId(req);

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    // A malformed id used to reach Mongoose and surface as a 500 CastError.
    if (!validateObjectId(courseid)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID",
      });
    }

    try {
      const [course, enrollment] = await Promise.all([
        CourseModel.findById(courseid).lean(),
        EnrolledCourseModel.findOne({ courseId: courseid, userId }).lean(),
      ]);

      if (!course) {
        return res.status(404).send({
          success: false,
          message: "No such course found",
        });
      }

      // 403, not 404: the account exists, it is this course it has no claim on.
      if (!enrollment) {
        return res.status(403).send({
          success: false,
          message: "You are not enrolled in this course",
        });
      }

      const progress = buildProgressSummary(enrollment);
      const sections = describeSections(course.sections, enrollment.progress);

      return res.status(200).send({
        success: true,
        // `courseContent` and `completeModule` keep their original names and
        // shapes. Anything still reading them keeps working; the fields below
        // are what the player uses now.
        courseContent: sections,
        completeModule: Array.isArray(enrollment.progress)
          ? enrollment.progress
          : [],
        courseTitle: course.C_title,
        courseEducator: course.C_educator,
        progress,
        isComplete: isEnrollmentComplete(enrollment),
        // Stamped by progressController when the last section is completed.
        // Null until then, rather than the enrolment's last-write timestamp.
        certificateDate: enrollment.certificateDate || null,
        enrolledAt: enrollment.createdAt || null,
      });
    } catch (error) {
      logger.error("Error fetching course content", {
        courseId: courseid,
        message: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).send({
        success: false,
        message: "Internal server error",
      });
    }
  };
}

const getCourseContentController = (req, res) =>
  createGetCourseContentController()(req, res);

module.exports = {
  createGetCourseContentController,
  getCourseContentController,
  getRequestingUserId,
  // Original export name, kept so the userControllers aggregator and the route
  // wiring tests can both keep referring to it.
  sendCourseContentController: getCourseContentController,
};
