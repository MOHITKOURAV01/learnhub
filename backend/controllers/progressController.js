const mongoose = require("mongoose");
const courseSchema = require("../schemas/courseModel");
const enrolledCourseSchema = require("../schemas/enrolledCourseModel");

function normalizeSectionId(sections, sectionId) {
  const normalizedSections = Array.isArray(sections) ? sections : [];

  if (
    typeof sectionId === "number" ||
    (typeof sectionId === "string" && /^\d+$/.test(sectionId.trim()))
  ) {
    const sectionIndex = Number(sectionId);

    if (
      Number.isSafeInteger(sectionIndex) &&
      sectionIndex >= 0 &&
      sectionIndex < normalizedSections.length
    ) {
      return sectionIndex;
    }
  }

  if (typeof sectionId === "string" && sectionId.trim()) {
    const requestedId = sectionId.trim();
    const matchingSection = normalizedSections.find((section) => {
      if (!section || typeof section !== "object") return false;

      const candidateId = section._id || section.id;
      return candidateId && String(candidateId) === requestedId;
    });

    if (matchingSection) {
      return requestedId;
    }
  }

  return null;
}

function getAuthenticatedUserId(req) {
  return req.user?._id || req.user?.id || req.body?.userId || null;
}

function createCompleteSectionController({
  CourseModel = courseSchema,
  EnrolledCourseModel = enrolledCourseSchema,
} = {}) {
  return async function completeSectionController(req, res) {
    const { courseId, sectionId } = req.body || {};
    const userId = getAuthenticatedUserId(req);

    if (!courseId || sectionId === undefined || sectionId === null) {
      return res.status(400).send({
        success: false,
        message: "courseId and sectionId are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid courseId",
      });
    }

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    try {
      const course = await CourseModel.findById(courseId);

      if (!course) {
        return res.status(404).send({
          success: false,
          message: "Course not found",
        });
      }

      const normalizedSectionId = normalizeSectionId(
        course.sections,
        sectionId,
      );

      if (normalizedSectionId === null) {
        return res.status(404).send({
          success: false,
          message: "Section not found in this course",
        });
      }

      const enrollment = await EnrolledCourseModel.findOne({
        courseId,
        userId,
      });

      if (!enrollment) {
        return res.status(403).send({
          success: false,
          message: "User is not enrolled in this course",
        });
      }

      const updateResult = await EnrolledCourseModel.updateOne(
        {
          _id: enrollment._id,
          "progress.sectionId": { $ne: normalizedSectionId },
        },
        {
          $addToSet: {
            progress: { sectionId: normalizedSectionId },
          },
        },
      );

      if (updateResult.modifiedCount === 0) {
        return res.status(200).send({
          success: true,
          alreadyCompleted: true,
          message: "Section was already completed",
        });
      }

      return res.status(200).send({
        success: true,
        alreadyCompleted: false,
        message: "Section completed successfully",
      });
    } catch (error) {
      console.error("Error completing section:", error);
      return res.status(500).send({
        success: false,
        message: "Internal server error",
      });
    }
  };
}

const completeSectionController = createCompleteSectionController();

module.exports = {
  completeSectionController,
  createCompleteSectionController,
  getAuthenticatedUserId,
  normalizeSectionId,
};
