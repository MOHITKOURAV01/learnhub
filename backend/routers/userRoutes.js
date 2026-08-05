const express = require("express");
const multer = require("multer");
const path = require("path");

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

const {
  completeSectionController,
} = require("../controllers/progressController");

const checkRole = require("../middlewares/roleMiddleware");
const {
  deleteCourseController,
} = require("../controllers/courseDeletionController");

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const fileExtension = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + fileExtension);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, callback) {
    var ext = path.extname(file.originalname);
    if (ext !== ".mp4") {
      return callback(new Error("Only .mp4 videos are allowed"));
    }
    callback(null, true);
  }
});

router.post("/register", registerController);

router.post("/login", loginController);

router.post(
  "/addcourse",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  // upload.single('C_image'),
  upload.array("S_content"),
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
