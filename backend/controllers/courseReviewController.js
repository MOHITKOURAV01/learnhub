const mongoose = require("mongoose");
const CourseReview = require("../schemas/courseReviewModel");
const Course = require("../schemas/courseModel");
const EnrolledCourse = require("../schemas/enrolledCourseModel");
const {
  MAX_SUMMARY_IDS,
  buildSummaryMap,
  buildSummaryPipeline,
  emptySummary,
  formatSummaryRow,
  normalizeCourseIds,
} = require("../utils/reviewSummaries");

const ALLOWED_SORTS = new Set(["newest", "oldest", "highest", "lowest"]);

const parsePositiveInteger = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const validateCourseId = (courseId) => mongoose.Types.ObjectId.isValid(courseId);

const getAuthenticatedUserId = (req) =>
  req.user?._id?.toString() || req.body?.userId || null;

const serializeReview = (review, currentUserId = null) => ({
  id: review._id.toString(),
  rating: review.rating,
  reviewText: review.reviewText || "",
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
  verifiedEnrollment: true,
  user: {
    id: review.userId?._id?.toString() || review.userId?.toString() || null,
    name: review.userId?.name || "LearnHub student",
  },
  isOwner:
    Boolean(currentUserId) &&
    String(review.userId?._id || review.userId) === String(currentUserId),
});

// One course. Same pipeline as the batch path, so the two cannot drift apart.
const getSummary = async (courseId) => {
  const [summary] = await CourseReview.aggregate(
    buildSummaryPipeline([String(courseId)]),
  );

  return summary ? formatSummaryRow(summary) : emptySummary();
};

// Many courses, one indexed pass. CourseRatingBadge used to call the single
// endpoint once per card, so a twelve-card catalogue page ran twelve of these.
const getSummariesFor = async (courseIds) => {
  if (courseIds.length === 0) return {};

  const rows = await CourseReview.aggregate(buildSummaryPipeline(courseIds));

  return buildSummaryMap(courseIds, rows);
};

const ensureCourseExists = async (courseId) => {
  const course = await Course.findById(courseId).select("_id C_title").lean();
  return course;
};

const ensureEnrollment = async (userId, courseId) => {
  return EnrolledCourse.findOne({ userId, courseId }).select("_id").lean();
};

const createReview = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const rating = Number(req.body.rating);
    const reviewText = String(req.body.reviewText || "").trim();

    if (!userId || !validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "A valid course and authenticated user are required.",
      });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).send({
        success: false,
        message: "Rating must be an integer from 1 to 5.",
      });
    }

    if (reviewText.length > 1000) {
      return res.status(400).send({
        success: false,
        message: "Review text cannot exceed 1000 characters.",
      });
    }

    const course = await ensureCourseExists(courseId);
    if (!course) {
      return res.status(404).send({
        success: false,
        message: "Course not found.",
      });
    }

    const enrollment = await ensureEnrollment(userId, courseId);
    if (!enrollment) {
      return res.status(403).send({
        success: false,
        message: "Only enrolled students can review this course.",
      });
    }

    const review = await CourseReview.create({
      userId,
      courseId,
      rating,
      reviewText,
    });

    await review.populate("userId", "name");

    return res.status(201).send({
      success: true,
      message: "Review submitted successfully.",
      data: serializeReview(review, userId),
      summary: await getSummary(courseId),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).send({
        success: false,
        message: "You have already reviewed this course.",
      });
    }

    console.error("Unable to create course review:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to submit the review.",
    });
  }
};

const listReviews = async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID.",
      });
    }

    const page = parsePositiveInteger(req.query.page, 1, 100000);
    const limit = parsePositiveInteger(req.query.limit, 5, 25);
    const sort = String(req.query.sort || "newest").toLowerCase();

    if (!ALLOWED_SORTS.has(sort)) {
      return res.status(400).send({
        success: false,
        message: "Invalid review sort option.",
      });
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      highest: { rating: -1, createdAt: -1 },
      lowest: { rating: 1, createdAt: -1 },
    };

    const totalItems = await CourseReview.countDocuments({ courseId });
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const safePage = Math.min(page, totalPages);
    const currentUserId = req.user?._id?.toString() || null;

    const reviews = await CourseReview.find({ courseId })
      .populate("userId", "name")
      .sort(sortMap[sort])
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    return res.status(200).send({
      success: true,
      data: reviews.map((review) => serializeReview(review, currentUserId)),
      summary: await getSummary(courseId),
      pagination: {
        page: safePage,
        limit,
        totalItems,
        totalPages,
        hasPreviousPage: safePage > 1,
        hasNextPage: safePage < totalPages,
      },
      sort,
    });
  } catch (error) {
    console.error("Unable to retrieve course reviews:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve course reviews.",
    });
  }
};

/**
 * GET /api/reviews/summaries?courseIds=a,b,c
 *
 * Registered before GET /:courseId in the router, or "summaries" would match
 * the parameter and this route would never be reached — the same shadowing
 * that made DELETE /api/admin/deleteuser unauthenticated in #53.
 */
const getRatingSummaries = async (req, res) => {
  try {
    const courseIds = normalizeCourseIds(req.query.courseIds);

    // An empty or entirely unusable list is not an error: the client asked
    // about no courses and gets summaries for no courses.
    return res.status(200).send({
      success: true,
      data: await getSummariesFor(courseIds),
      requested: courseIds.length,
      limit: MAX_SUMMARY_IDS,
    });
  } catch (error) {
    console.error("Unable to retrieve rating summaries:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve rating summaries.",
    });
  }
};

const getRatingSummary = async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID.",
      });
    }

    return res.status(200).send({
      success: true,
      data: await getSummary(courseId),
    });
  } catch (error) {
    console.error("Unable to retrieve rating summary:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve rating summary.",
    });
  }
};

const updateReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const rating = Number(req.body.rating);
    const reviewText = String(req.body.reviewText || "").trim();

    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid review ID.",
      });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).send({
        success: false,
        message: "Rating must be an integer from 1 to 5.",
      });
    }

    if (reviewText.length > 1000) {
      return res.status(400).send({
        success: false,
        message: "Review text cannot exceed 1000 characters.",
      });
    }

    const review = await CourseReview.findOneAndUpdate(
      { _id: reviewId, userId },
      { rating, reviewText },
      { new: true, runValidators: true },
    ).populate("userId", "name");

    if (!review) {
      return res.status(404).send({
        success: false,
        message: "Review not found or you do not own it.",
      });
    }

    return res.status(200).send({
      success: true,
      message: "Review updated successfully.",
      data: serializeReview(review, userId),
      summary: await getSummary(review.courseId.toString()),
    });
  } catch (error) {
    console.error("Unable to update course review:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to update the review.",
    });
  }
};

const deleteReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid review ID.",
      });
    }

    const review = await CourseReview.findOneAndDelete({
      _id: reviewId,
      userId,
    });

    if (!review) {
      return res.status(404).send({
        success: false,
        message: "Review not found or you do not own it.",
      });
    }

    return res.status(200).send({
      success: true,
      message: "Review deleted successfully.",
      summary: await getSummary(review.courseId.toString()),
    });
  } catch (error) {
    console.error("Unable to delete course review:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to delete the review.",
    });
  }
};

const getMyReview = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (!validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID.",
      });
    }

    const [review, enrollment] = await Promise.all([
      CourseReview.findOne({ courseId, userId })
        .populate("userId", "name")
        .lean(),
      ensureEnrollment(userId, courseId),
    ]);

    return res.status(200).send({
      success: true,
      data: review ? serializeReview(review, userId) : null,
      canReview: Boolean(enrollment),
    });
  } catch (error) {
    console.error("Unable to retrieve current review:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve your review.",
    });
  }
};

module.exports = {
  createReview,
  listReviews,
  getRatingSummaries,
  getRatingSummary,
  updateReview,
  deleteReview,
  getMyReview,
};
