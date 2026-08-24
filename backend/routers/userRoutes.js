const express = require("express");
const multer = require("multer");

const authMiddleware = require("../middlewares/authMiddleware");
const {
  registerController,
  loginController,
  logoutController,
  postCourseController,
  getAllCoursesUserController,
  getAllCoursesController,
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

const checkRole = require("../middlewares/roleMiddleware");
const {
  getEnrolledCoursesController,
} = require("../controllers/enrolledCoursesController");
const {
  enrollCourseController,
} = require("../controllers/enrollmentController");
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

router.post("/register", registerController);

router.post("/login", loginController);

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
  enrollCourseController
);

router.get(
  "/coursecontent/:courseid",
  authMiddleware,
  sendCourseContentController
);

router.post("/completemodule", authMiddleware, completeSectionController);

router.get("/getallcoursesuser", authMiddleware, getEnrolledCoursesController);

// Authenticated, unlike the rest of this group: an open endpoint would let
// anyone write activity log rows for any account. There is no server-side
// session to destroy — the token is stateless — so this exists purely so
// signing out is recorded.
router.post("/logout", authMiddleware, logoutController);

router.post("/verify-otp", verifyOtpController);
// Without this an account whose OTP expired had no route back: registering
// again answered "User already exists" and logging in answered "Email is not
// verified". The cooldown lives in the controller, not here, so it applies
// however the code is requested.
router.post("/resend-otp", resendOtpController);
router.post("/forgot-password", forgotPasswordController);
router.post("/reset-password", resetPasswordController);

module.exports = router;
