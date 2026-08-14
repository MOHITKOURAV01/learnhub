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
  sendAllCoursesUserController,
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

router.post("/completemodule", authMiddleware, completeSectionController);

router.get("/getallcoursesuser", authMiddleware, sendAllCoursesUserController);

router.post("/verify-otp", verifyOtpController);
router.post("/forgot-password", forgotPasswordController);
router.post("/reset-password", resetPasswordController);

module.exports = router;
