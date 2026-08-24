const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const checkRole = require("../middlewares/roleMiddleware");
const validateObjectId = require("../middlewares/validateObjectId");

const {
  adminLoginController,
  adminResetPasswordController,
  deleteUserController,
  getAllCoursesController,
  getAllEnrolledCoursesController,
  getAllUsersController,
} = require("../controllers/adminController");

// The same controller the teacher route uses. It has always accepted an admin
// (`["teacher", "admin"].includes(role)`) and it removes the section videos and
// the rows that referenced the course; the copy in adminController did neither.
const {
  deleteCourseController,
} = require("../controllers/courseDeletionController");

const {
  getAdminPaymentsController,
} = require("../controllers/paymentRecordsController");

const {
  getActivityLogsController,
} = require("../controllers/activityLogController");

const router = express.Router();

// Every route below /api/admin except the login itself requires a valid token
// and the admin role. Applying the guard once at the router level means a new
// route cannot be added without it, which is how DELETE /deleteuser ended up
// unauthenticated.
const requireAdmin = [authMiddleware, checkRole(["admin"])];

router.post("/login", adminLoginController);

router.get("/getallusers", requireAdmin, getAllUsersController);

router.get("/enrolled-courses", requireAdmin, getAllEnrolledCoursesController);

router.get("/payments", requireAdmin, getAdminPaymentsController);

router.get("/activity-logs", requireAdmin, getActivityLogsController);

router.get("/getallcourses", requireAdmin, getAllCoursesController);

router.delete(
  "/deletecourse/:courseid",
  requireAdmin,
  validateObjectId("courseid", "course ID"),
  deleteCourseController,
);

router.delete(
  "/deleteuser/:userid",
  requireAdmin,
  validateObjectId("userid", "user ID"),
  deleteUserController,
);

router.post(
  "/reset-password/:userid",
  requireAdmin,
  validateObjectId("userid", "user ID"),
  adminResetPasswordController,
);

module.exports = router;
