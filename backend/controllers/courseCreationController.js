const { cleanupUploadedFiles } = require("../utils/uploadCleanup");
const {
  formatCourseMessage,
  normalizeSectionField,
  validateCourseSubmission,
} = require("../utils/courseInput");

/**
 * Builds the POST /api/user/addcourse handler.
 *
 * The owner of a new course used to be whatever `userId` the multipart form
 * carried. Multer replaces `req.body` when it parses a multipart request, so
 * the value authMiddleware wrote there was gone by the time this ran and the
 * client was choosing. Ownership now comes from `req.user`, which Multer does
 * not touch, and the body is only consulted for course content.
 */
function createPostCourseController({
  Course,
  cleanupFiles = cleanupUploadedFiles,
  logger = console,
} = {}) {
  return async function postCourseController(req, res) {
    const CourseModel = Course || require("../schemas/courseModel");
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    const submission = validateCourseSubmission({
      body: req.body || {},
      files: uploadedFiles,
      user: req.user,
    });

    if (!submission.valid) {
      // The videos are already on disk by the time the controller runs, so a
      // rejected submission has to take them with it.
      const cleanupResult = await cleanupFiles(uploadedFiles);

      if (cleanupResult.failed.length > 0) {
        logger.warn(
          "Rejected course submission left temporary files behind",
          { failedFiles: cleanupResult.failed.length },
        );
      }

      // A missing token is not the same mistake as a missing title, and the
      // client needs to be able to tell them apart.
      const status = submission.unauthenticated ? 401 : 400;

      return res.status(status).send({
        success: false,
        message: formatCourseMessage(submission.errors),
        errors: submission.errors,
      });
    }

    try {
      const course = new CourseModel(submission.value);

      await course.save();

      return res.status(201).send({
        success: true,
        message: "Course created successfully",
        // The id lets a client navigate straight to what it just created
        // instead of re-listing every course to find it.
        data: { id: course._id, C_title: submission.value.C_title },
      });
    } catch (error) {
      const cleanupResult = await cleanupFiles(uploadedFiles);

      logger.error("Error creating course", {
        userId: submission.value.userId,
        message:
          error instanceof Error
            ? error.message
            : "Unknown course creation error",
        cleanupFailedFiles: cleanupResult.failed.length,
      });

      return res.status(500).send({
        success: false,
        message: "Failed to create course",
      });
    }
  };
}

const postCourseController = (req, res) =>
  createPostCourseController()(req, res);

module.exports = {
  createPostCourseController,
  // Re-exported from utils/courseInput, where the section pairing now lives.
  // Kept on this module so existing importers do not have to change.
  normalizeSectionField,
  postCourseController,
};
