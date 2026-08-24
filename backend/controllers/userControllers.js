const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");

const userSchema = require("../schemas/userModel");
const courseSchema = require("../schemas/courseModel");
const enrolledCourseSchema = require("../schemas/enrolledCourseModel");
const { ACTIONS, recordActivity } = require("../utils/activityLog");
const {
  formatValidationMessage,
  validateRegistration,
} = require("../utils/registrationValidation");
const {
  buildEmailFilter,
  isDuplicateOn,
} = require("../utils/accountIdentity");
const {
  postCourseController,
} = require("./courseCreationController");
const {
  getTeacherCoursesController,
} = require("./teacherCoursesController");

// The route wiring imports this from teacherCoursesController directly. The
// aggregator keeps re-exporting it under its original name so nothing that
// still reads it from here has to change.
const getAllCoursesUserController = getTeacherCoursesController;
const {
  getAllCoursesController,
} = require("./courseListingController");
//////////for registering/////////////////////////////
const registerController = async (req, res) => {
  try {
    // The document used to be built from { ...req.body }, which let a client
    // set `type` and register itself as a teacher or an admin. Only the
    // validated allow-list is used now.
    const { valid, errors, value } = validateRegistration(req.body);

    if (!valid) {
      return res.status(400).send({
        success: false,
        message: formatValidationMessage(errors),
        errors,
      });
    }

    const existsUser = await userSchema.findOne(buildEmailFilter(value.email));
    if (existsUser) {
      return res
        .status(200)
        .send({ message: "User already exists", success: false });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(value.password, salt);

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    const newUser = new userSchema({
      name: value.name,
      email: value.email,
      password: hashedPassword,
      type: value.type,
      isVerified: false,
      otp,
      otpExpiry,
    });

    try {
      await newUser.save();
    } catch (writeError) {
      // The findOne above is a read, and the write happens later. Two requests
      // for the same address both get past that check, and the unique index is
      // what actually stops the second one. Answer it the same way the
      // pre-check does rather than surfacing an opaque 500.
      if (isDuplicateOn(writeError, "email")) {
        return res
          .status(200)
          .send({ message: "User already exists", success: false });
      }

      throw writeError;
    }

    // Send email
    await sendEmail({
      to: value.email,
      subject: "Verify your LearnHub Account",
      text: `Your OTP code for verification is: ${otp}. This code is valid for 10 minutes.`,
      html: `<p>Your OTP code for verification is: <strong>${otp}</strong>.</p><p>This code is valid for 10 minutes.</p>`,
    });

    return res.status(201).send({ message: "Registration initiated. Please verify the OTP sent to your email.", success: true });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .send({ success: false, message: `${error.message}` });
  }
};

////for the login
const loginController = async (req, res) => {
  const attemptedEmail =
    typeof req.body?.email === "string" ? req.body.email : "";

  try {
    // Addresses are stored lowercase, so the lookup has to be normalised too.
    // Signing in as "User@Example.com" used to miss the row entirely and
    // report "User not found" for an account that exists.
    const emailFilter = buildEmailFilter(req.body?.email);

    // password is select: false on the schema, so ask for it explicitly.
    const user = await userSchema.findOne(emailFilter).select("+password");
    if (!user) {
      // A failed attempt used to leave no trace at all, so the log could not
      // answer the one question an audit log exists for. The attempted address
      // is recorded; the attempted password is not, and never should be.
      await recordActivity({
        action: ACTIONS.LOGIN_FAILED,
        req,
        email: attemptedEmail,
      });

      return res
        .status(200)
        .send({ message: "User not found", success: false });
    }
    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) {
      await recordActivity({
        action: ACTIONS.LOGIN_FAILED,
        req,
        userId: user._id,
        role: user.type,
        email: user.email,
      });

      return res
        .status(200)
        .send({ message: "Invalid email or password", success: false });
    }

    if (!user.isVerified) {
      return res
        .status(200)
        .send({ message: "Email is not verified. Please verify your email first.", success: false, notVerified: true });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });
    user.password = undefined;

    // Best effort: recordActivity swallows its own failures, so an unwritable
    // audit row can no longer turn a successful sign-in into a 500.
    await recordActivity({
      action: ACTIONS.LOGIN,
      req,
      userId: user._id,
      role: user.type,
      email: user.email,
    });

    return res.status(200).send({
      message: "Login success successfully",
      success: true,
      token,
      userData: user,
    });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .send({ success: false, message: `${error.message}` });
  }
};

/**
 * POST /api/user/logout
 *
 * The activity log has always accepted a "logout" action and the admin table
 * has always offered a Logout filter, but signing out was client-only —
 * `clearSession()` and a redirect — so the filter matched nothing, ever.
 *
 * Authenticated, because an open endpoint would let anyone write log rows for
 * any account. There is no server-side session to destroy: the token is
 * stateless and the client discards it.
 */
const logoutController = async (req, res) => {
  const user = req.user || {};

  await recordActivity({
    action: ACTIONS.LOGOUT,
    req,
    userId: user._id && user._id !== "admin" ? user._id : undefined,
    role: user.type || user.role,
    email: user.email,
  });

  return res
    .status(200)
    .send({ success: true, message: "Signed out" });
};

//get all courses
// Implemented in courseListingController for isolated query validation and tests.

////////posting course////////////
// Implemented in courseCreationController so upload cleanup is testable.

///all courses for the teacher
// Implemented in teacherCoursesController so the list is paginated and
// projected like every other list endpoint, the owner is resolved from
// req.user rather than req.body.userId, and the section count is computed
// server-side for all three shapes `sections` takes (#94).

///delete courses by the teacher
// Implemented in courseDeletionController so ownership is enforced against the
// authenticated identity and orphaned section videos are cleaned up (#40).

////enrolled course by the student
// Implemented in enrollmentController so section counting, idempotency and the
// enrolled counter can be unit tested with injected models.

/////sending the course content for learning to student
const sendCourseContentController = async (req, res) => {
  const { courseid } = req.params;

  try {
    const course = await courseSchema.findById({ _id: courseid });
    if (!course)
      return res.status(404).send({
        success: false,
        message: "No such course found",
      });

    const user = await enrolledCourseSchema.findOne({
      userId: req.body.userId,
      courseId: courseid, // Add the condition to match the courseId
    });

    if (!user) {
      return res.status(404).send({
        success: false,
        message: "User not found",
      });
    } else {
      return res.status(200).send({
        success: true,
        courseContent: course.sections,
        completeModule: user.progress,
        certficateData: user,
      });
    }
  } catch (error) {
    console.error("An error occurred:", error);
    return res.status(500).send({
      success: false,
      message: "Internal server error",
    });
  }
};

//////////////completing module////////
// Implemented in progressController so the section is validated against the
// course and repeated calls cannot duplicate progress entries (#39).

////////////get all courses for paricular user
// Implemented in enrolledCoursesController so the batched lookup, the
// deleted-course filtering and the progress summary are unit testable.

const verifyOtpController = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).send({ message: "Email and OTP are required", success: false });
    }
    const user = await userSchema
      .findOne(buildEmailFilter(email))
      .select("+otp +otpExpiry");
    if (!user) {
      return res.status(404).send({ message: "User not found", success: false });
    }
    if (user.isVerified) {
      return res.status(200).send({ message: "User already verified", success: true });
    }
    if (user.otp !== otp || user.otpExpiry < Date.now()) {
      return res.status(400).send({ message: "Invalid or expired OTP", success: false });
    }
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();
    return res.status(200).send({ message: "Email verified successfully", success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).send({ success: false, message: error.message });
  }
};

const forgotPasswordController = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).send({ message: "Email is required", success: false });
    }
    const user = await userSchema.findOne(buildEmailFilter(email));
    if (!user) {
      return res.status(200).send({ message: "If that email exists, an OTP/reset token has been sent.", success: true });
    }
    
    const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
    const resetTokenExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    user.resetToken = resetToken;
    user.resetTokenExpiry = resetTokenExpiry;
    await user.save();

    await sendEmail({
      to: email,
      subject: "LearnHub Password Reset Request",
      text: `Your password reset code is: ${resetToken}. This code is valid for 10 minutes.`,
      html: `<p>Your password reset code is: <strong>${resetToken}</strong>.</p><p>This code is valid for 10 minutes.</p>`,
    });

    return res.status(200).send({ message: "If that email exists, an OTP/reset token has been sent.", success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).send({ success: false, message: error.message });
  }
};

const resetPasswordController = async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword) {
      return res.status(400).send({ message: "Email, token, and newPassword are required", success: false });
    }
    if (newPassword.length < 6) {
      return res.status(400).send({ message: "Password must be at least 6 characters.", success: false });
    }
    const user = await userSchema
      .findOne(buildEmailFilter(email))
      .select("+resetToken +resetTokenExpiry");
    if (!user) {
      return res.status(404).send({ message: "User not found", success: false });
    }
    if (user.resetToken !== token || user.resetTokenExpiry < Date.now()) {
      return res.status(400).send({ message: "Invalid or expired reset token/OTP", success: false });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    user.password = hashedPassword;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    user.isVerified = true; // Auto-verify email
    await user.save();
    return res.status(200).send({ message: "Password has been successfully updated", success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).send({ success: false, message: error.message });
  }
};

module.exports = {
  registerController,
  loginController,
  logoutController,
  getAllCoursesController,
  postCourseController,
  getAllCoursesUserController,
  sendCourseContentController,
  verifyOtpController,
  forgotPasswordController,
  resetPasswordController,
};
