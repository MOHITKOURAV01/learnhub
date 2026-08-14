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

const checkRole = require("../middlewares/roleMiddleware");
const {
  getEnrolledCoursesController,
} = require("../controllers/enrolledCoursesController");
const {
  createRateLimiter,
  rateLimitSettingsFromEnv,
} = require("../middlewares/rateLimiter");
const {
  createVerificationThrottle,
  throttleSettingsFromEnv,
} = require("../middlewares/verificationThrottle");
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

// Two layers guard every credential endpoint: a per-client rate limit that caps
// request volume, and a per-account failure throttle that locks the targeted
// email address so rotating source addresses does not help.
const rateLimitSettings = rateLimitSettingsFromEnv();
const throttleSettings = throttleSettingsFromEnv();

const credentialRateLimiter = (scope) =>
  createRateLimiter({ ...rateLimitSettings, scope });

const credentialThrottle = (scope) =>
  createVerificationThrottle({ ...throttleSettings, scope });

router.post("/register", credentialRateLimiter("register"), registerController);

router.post(
  "/login",
  credentialRateLimiter("login"),
  credentialThrottle("login"),
  loginController,
);

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

router.post("/completemodule", authMiddleware, completeSectionController);

router.get("/getallcoursesuser", authMiddleware, getEnrolledCoursesController);

router.post(
  "/verify-otp",
  credentialRateLimiter("verify-otp"),
  credentialThrottle("verify-otp"),
  verifyOtpController,
);

// No failure throttle here: this endpoint answers the same way for known and
// unknown addresses on purpose, so there is no failure to count. The rate limit
// is what stops it being used as a mail bomb.
router.post(
  "/forgot-password",
  credentialRateLimiter("forgot-password"),
  forgotPasswordController,
);

router.post(
  "/reset-password",
  credentialRateLimiter("reset-password"),
  credentialThrottle("reset-password"),
  resetPasswordController,
);

module.exports = router;
