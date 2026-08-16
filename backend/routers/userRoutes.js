const express = require("express");
const multer = require("multer");

const authMiddleware = require("../middlewares/authMiddleware");
const {
  registerController,
  loginController,
  postCourseController,
  getAllCoursesUserController,
  getAllCoursesController,
  enrolledCourseController,
  sendCourseContentController,
  verifyOtpController,
  forgotPasswordController,
  resetPasswordController,
} = require("../controllers/userControllers");

// Course deletion and progress tracking are imported from their own modules
// rather than through the userControllers aggregator. Both enforce checks that
// the request body cannot influence, so the wiring is kept explicit here.
const {
  deleteCourseController,
} = require("../controllers/courseDeletionController");
const {
  completeSectionController,
} = require("../controllers/progressController");
const {
  resendOtpController,
} = require("../controllers/emailVerificationController");
const {
  courseVideoController,
} = require("../controllers/courseVideoController");

const checkRole = require("../middlewares/roleMiddleware");
const {
  getEnrolledCoursesController,
} = require("../controllers/enrolledCoursesController");
const {
  createCourseVideoUpload,
} = require("../utils/videoUpload");
const {
  createCourseVideoUploadMiddleware,
} = require("../utils/courseVideoUploadMiddleware");

const router = express.Router();

const upload = createCourseVideoUpload({
  multerLib: multer,
});

const courseVideoUpload = createCourseVideoUploadMiddleware({
  upload,
});

router.post("/register", registerController);

router.post("/login", loginController);

router.post(
  "/addcourse",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  courseVideoUpload,
  postCourseController
);

router.get("/getallcourses", getAllCoursesController);

router.get(
  "/getallcoursesteacher",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  getAllCoursesUserController
);

router.delete(
  "/deletecourse/:courseid",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  deleteCourseController
);

router.post(
  "/enrolledcourse/:courseid",
  authMiddleware,
  enrolledCourseController
);

router.get(
  "/coursecontent/:courseid",
  authMiddleware,
  sendCourseContentController
);

// No authMiddleware: a <video> element cannot send an Authorization header, so
// this route authenticates on the short-lived, course-scoped playback token
// that /coursecontent hands out after checking enrolment. It replaces the
// public express.static handler on /uploads.
router.get("/coursevideo/:courseid/:sectionIndex", courseVideoController);

router.post("/completemodule", authMiddleware, completeSectionController);

router.get("/getallcoursesuser", authMiddleware, getEnrolledCoursesController);

router.post("/verify-otp", verifyOtpController);
// Without this an account whose OTP expired had no route back: registering
// again answered "User already exists" and logging in answered "Email is not
// verified". The cooldown lives in the controller, not here, so it applies
// however the code is requested.
router.post("/resend-otp", resendOtpController);
router.post("/forgot-password", forgotPasswordController);
router.post("/reset-password", resetPasswordController);

module.exports = router;
