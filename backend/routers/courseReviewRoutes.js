const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  createReview,
  listReviews,
  getRatingSummaries,
  getRatingSummary,
  updateReview,
  deleteReview,
  getMyReview,
} = require("../controllers/courseReviewController");

const router = express.Router();

// Before "/:courseId", or Express matches this path as a course id and the
// batch route is unreachable. Registration order is what made
// DELETE /api/admin/deleteuser unauthenticated in #53; the same trap applies to
// any literal segment declared after a parameter.
router.get("/summaries", getRatingSummaries);

router.get("/:courseId", listReviews);
router.get("/:courseId/summary", getRatingSummary);
router.get("/:courseId/mine", authMiddleware, getMyReview);
router.post("/:courseId", authMiddleware, createReview);
router.put("/review/:reviewId", authMiddleware, updateReview);
router.delete("/review/:reviewId", authMiddleware, deleteReview);

module.exports = router;
