const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");

const userSchema = require("../schemas/userModel");
const courseSchema = require("../schemas/courseModel");
const enrolledCourseSchema = require("../schemas/enrolledCourseModel");
const ActivityLog = require('../schemas/activityLogModel');
const {
  formatValidationMessage,
  validateRegistration,
} = require("../utils/registrationValidation");
const {
  postCourseController,
} = require("./courseCreationController");
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

    const existsUser = await userSchema.findOne({ email: value.email });
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
    await newUser.save();

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
  try {
    // password is select: false on the schema, so ask for it explicitly.
    const user = await userSchema
      .findOne({ email: req.body.email })
      .select("+password");
    if (!user) {
      return res
        .status(200)
        .send({ message: "User not found", success: false });
    }
    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) {
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
    // Log login activity
    await ActivityLog.create({ userId: user._id, action: 'login', role: user.type, email: user.email });
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

//get all courses
// Implemented in courseListingController for isolated query validation and tests.

////////posting course////////////
// Implemented in courseCreationController so upload cleanup is testable.

///all courses for the teacher
const getAllCoursesUserController = async (req, res) => {
  try {
    const allCourses = await courseSchema.find({ userId: req.body.userId });
    if (!allCourses) {
      res.send({
        success: false,
        message: "No Courses Found",
      });
    } else {
      res.send({
        success: true,
        message: "All Courses Fetched Successfully",
        data: allCourses,
      });
    }
  } catch (error) {
    console.error("Error in fetching courses:", error);
    res
      .status(500)
      .send({ success: false, message: "Failed to fetch courses" });
  }
};

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
      .findOne({ email })
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
    const user = await userSchema.findOne({ email });
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
      .findOne({ email })
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
  getAllCoursesController,
  postCourseController,
  getAllCoursesUserController,
  sendCourseContentController,
  verifyOtpController,
  forgotPasswordController,
  resetPasswordController,
};
