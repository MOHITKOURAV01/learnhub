const { cleanupUploadedFiles } = require("../utils/uploadCleanup");

function normalizeSectionField(value, index) {
  return Array.isArray(value) ? value[index] : value;
}

function createPostCourseController({
  Course,
  cleanupFiles = cleanupUploadedFiles,
  logger = console,
} = {}) {
  return async function postCourseController(req, res) {
    const CourseModel = Course || require("../schemas/courseModel");
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    try {
      const {
        userId,
        C_educator,
        C_title,
        C_categories,
        C_price,
        C_description,
        S_title,
        S_description,
      } = req.body;

      const sections = uploadedFiles.map((file, index) => ({
        S_title: normalizeSectionField(S_title, index),
        S_content: {
          filename: file.filename,
          path: `/uploads/${file.filename}`,
        },
        S_description: normalizeSectionField(S_description, index),
      }));

      const course = new CourseModel({
        userId,
        C_educator,
        C_title,
        C_categories,
        C_price: C_price == 0 ? "free" : C_price,
        C_description,
        sections,
      });

      await course.save();

      return res.status(201).send({
        success: true,
        message: "Course created successfully",
      });
    } catch (error) {
      const cleanupResult = await cleanupFiles(uploadedFiles);

      logger.error("Error creating course", {
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
  normalizeSectionField,
  postCourseController,
};
