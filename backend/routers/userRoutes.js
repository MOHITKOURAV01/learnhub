const express = require("express");
const multer = require("multer");

const authMiddleware = require("../middlewares/authMiddleware");
const {
  registerController,
  loginController,
  logoutController,
  postCourseController,
  getAllCoursesController,
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
  getCourseContentController,
} = require("../controllers/courseContentController");
const {
  resendOtpController,
} = require("../controllers/emailVerificationController");

const checkRole = require("../middlewares/roleMiddleware");
const {
  getEnrolledCoursesController,
} = require("../controllers/enrolledCoursesController");
const {
  getTeacherCoursesController,
} = require("../controllers/teacherCoursesController");
const {
  enrollCourseController,
} = require("../controllers/enrollmentController");
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
const {
  preserveAuthIdentity,
} = require("../middlewares/preserveAuthIdentity");

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

// Multer replaces req.body, so the userId authMiddleware wrote there does not
// survive the upload. preserveAuthIdentity puts the token's id back before the
// controller runs; the controller itself reads req.user and does not depend on
// it, but nothing mounted after an upload should see a client-supplied userId.
router.post(
  "/addcourse",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  courseVideoUpload,
  preserveAuthIdentity,
  postCourseController
);

router.get("/getallcourses", getAllCoursesController);

router.get(
  "/getallcoursesteacher",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  getTeacherCoursesController
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
  enrollCourseController
);

router.get(
  "/coursecontent/:courseid",
  authMiddleware,
  getCourseContentController
);

router.post("/completemodule", authMiddleware, completeSectionController);

router.get("/getallcoursesuser", authMiddleware, getEnrolledCoursesController);

// Authenticated, unlike the rest of this group: an open endpoint would let
// anyone write activity log rows for any account. There is no server-side
// session to destroy — the token is stateless — so this exists purely so
// signing out is recorded.
//
// Not rate limited either: it needs a valid token to reach, which is the
// bound that matters, and throttling it would only make signing out fail.
router.post("/logout", authMiddleware, logoutController);

router.post(
  "/verify-otp",
  credentialRateLimiter("verify-otp"),
  credentialThrottle("verify-otp"),
  verifyOtpController,
);

// Without this an account whose OTP expired had no route back: registering
// again answered "User already exists" and logging in answered "Email is not
// verified". The cooldown lives in the controller, not here, so it applies
// however the code is requested.
//
// Rate limited like every other credential endpoint — it sends mail, so it is
// exactly the kind of route that should not accept unlimited requests. No
// failure throttle, for the same reason /forgot-password has none: it answers
// the same way for known and unknown addresses, so there is no failure to count.
router.post(
  "/resend-otp",
  credentialRateLimiter("resend-otp"),
  resendOtpController,
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
