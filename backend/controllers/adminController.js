const crypto = require("crypto");

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const userSchema = require("../schemas/userModel");
const courseSchema = require("../schemas/courseModel");
const enrolledCourseSchema = require("../schemas/enrolledCourseModel");
const coursePaymentSchema = require("../schemas/coursePaymentModel");
const ActivityLog = require("../schemas/activityLogModel");

// Fields that must never leave the server. password is a bcrypt hash, and otp
// and resetToken are live credentials: anything holding them can complete
// /verify-otp or /reset-password for that account.
const SENSITIVE_USER_FIELDS = [
  "password",
  "otp",
  "otpExpiry",
  "resetToken",
  "resetTokenExpiry",
];

const PUBLIC_USER_PROJECTION = SENSITIVE_USER_FIELDS.map(
  (field) => `-${field}`,
).join(" ");

/**
 * Compares two strings without leaking length or content through timing.
 */
const safeEquals = (left, right) => {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
};

/**
 * Resolves the configured admin credentials.
 *
 * ADMIN_PASSWORD_HASH is preferred. ADMIN_PASSWORD is accepted so an existing
 * local setup keeps working, but it is only usable outside production.
 */
const getAdminCredentials = () => {
  const username = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const plaintextPassword = process.env.ADMIN_PASSWORD;

  if (!username || (!passwordHash && !plaintextPassword)) {
    return null;
  }

  if (!passwordHash && process.env.NODE_ENV === "production") {
    return null;
  }

  return { username, passwordHash, plaintextPassword };
};

const verifyAdminPassword = async (credentials, candidate) => {
  if (credentials.passwordHash) {
    return bcrypt.compare(String(candidate ?? ""), credentials.passwordHash);
  }

  return safeEquals(candidate, credentials.plaintextPassword);
};

const adminLoginController = async (req, res) => {
  try {
    const { username, password } = req.body || {};

    // Signing with an undefined secret throws inside this async handler, and
    // Express 4 does not forward the rejection, so the request used to hang.
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured; admin login is disabled.");
      return res.status(500).send({
        success: false,
        message: "Authentication is not configured on this server",
      });
    }

    const credentials = getAdminCredentials();

    if (!credentials) {
      console.error(
        "Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH.",
      );
      return res.status(500).send({
        success: false,
        message: "Admin access is not configured on this server",
      });
    }

    const usernameMatches = safeEquals(username, credentials.username);
    const passwordMatches = await verifyAdminPassword(credentials, password);

    if (!usernameMatches || !passwordMatches) {
      return res
        .status(401)
        .send({ success: false, message: "Invalid admin credentials" });
    }

    // Signed with JWT_SECRET so authMiddleware, which verifies with the same
    // variable, can actually accept the token.
    const token = jwt.sign({ id: "admin", role: "admin" }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    await ActivityLog.create({
      action: "login",
      role: "Admin",
      email: credentials.username,
    });

    return res
      .status(200)
      .send({ success: true, token, message: "Admin login successful" });
  } catch (error) {
    console.error("Admin login failed:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Admin login failed" });
  }
};

// Admin reset user password
const adminResetPasswordController = async (req, res) => {
  const { userid } = req.params;
  const { newPassword } = req.body || {};

  if (!newPassword || newPassword.length < 6) {
    return res
      .status(400)
      .send({ success: false, message: "Password must be at least 6 characters." });
  }

  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    const user = await userSchema.findByIdAndUpdate(userid, {
      password: hashed,
      $unset: { resetToken: "", resetTokenExpiry: "" },
    });

    if (!user) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    return res
      .status(200)
      .send({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Admin password reset failed:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to reset password" });
  }
};

// Get all enrolled courses (for admin dashboard)
const getAllEnrolledCoursesController = async (req, res) => {
  try {
    const enrolled = await enrolledCourseSchema
      .find()
      .populate("userId", "name email")
      .populate("courseId", "C_title");

    return res.status(200).send({ success: true, data: enrolled });
  } catch (error) {
    console.error("Failed to fetch enrolled courses:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to fetch enrolled courses" });
  }
};

// Get all course payments (for admin dashboard)
const getAllPaymentsController = async (req, res) => {
  try {
    const payments = await coursePaymentSchema
      .find()
      .populate("userId", "name email")
      .populate("courseId", "C_title");

    return res.status(200).send({ success: true, data: payments });
  } catch (error) {
    console.error("Failed to fetch payments:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to fetch payments" });
  }
};

const getAllUsersController = async (req, res) => {
  try {
    // Without an explicit projection this returned password hashes and live
    // OTP and reset tokens for every account.
    const allUsers = await userSchema.find().select(PUBLIC_USER_PROJECTION);

    return res.status(200).send({ success: true, data: allUsers });
  } catch (error) {
    console.error("Failed to fetch users:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to fetch users" });
  }
};

const getAllCoursesController = async (req, res) => {
  try {
    const allCourses = await courseSchema.find();

    return res.status(200).send({ success: true, data: allCourses });
  } catch (error) {
    console.error("Failed to fetch courses:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to fetch courses" });
  }
};

const deleteCourseController = async (req, res) => {
  const { courseid } = req.params;

  try {
    const course = await courseSchema.findByIdAndDelete(courseid);

    if (!course) {
      return res
        .status(404)
        .send({ success: false, message: "Course not found" });
    }

    return res
      .status(200)
      .send({ success: true, message: "Course deleted successfully" });
  } catch (error) {
    console.error("Error in deleting course:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to delete course" });
  }
};

const deleteUserController = async (req, res) => {
  const { userid } = req.params;

  try {
    const user = await userSchema.findByIdAndDelete(userid);

    if (!user) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    return res
      .status(200)
      .send({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Error in deleting user:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to delete user" });
  }
};

module.exports = {
  getAllUsersController,
  getAllCoursesController,
  deleteCourseController,
  deleteUserController,
  adminLoginController,
  getAllEnrolledCoursesController,
  getAllPaymentsController,
  adminResetPasswordController,
  PUBLIC_USER_PROJECTION,
  SENSITIVE_USER_FIELDS,
  getAdminCredentials,
  safeEquals,
};
