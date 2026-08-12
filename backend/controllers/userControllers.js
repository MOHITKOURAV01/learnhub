const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");

const userSchema = require("../schemas/userModel");
const courseSchema = require("../schemas/courseModel");
const enrolledCourseSchema = require("../schemas/enrolledCourseModel");
const coursePaymentSchema = require("../schemas/coursePaymentModel");
const ActivityLog = require('../schemas/activityLogModel');
const {
  postCourseController,
} = require("./courseCreationController");
const {
  getAllCoursesController,
} = require("./courseListingController");
//////////for registering/////////////////////////////
const registerController = async (req, res) => {
  try {
    const existsUser = await userSchema.findOne({ email: req.body.email });
    if (existsUser) {
      return res
        .status(200)
        .send({ message: "User already exists", success: false });
    }
    const password = req.body.password;
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    req.body.password = hashedPassword;

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    const newUser = new userSchema({
      ...req.body,
      isVerified: false,
      otp,
      otpExpiry,
    });
    await newUser.save();

    // Send email
    await sendEmail({
      to: req.body.email,
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
    const user = await userSchema.findOne({ email: req.body.email });
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

const enrolledCourseController = async (req, res) => {
  const { courseid } = req.params;
  const { userId } = req.body;
  try {
    const course = await courseSchema.findById(courseid);

    if (!course) {
      return res
        .status(404)
        .send({ success: false, message: "Course Not Found!" });
    }

    let course_Length = course.sections.length;

    // Check if the user is already enrolled in the course
    const enrolledCourse = await enrolledCourseSchema.findOne({
      courseId: courseid,
      userId: userId,
      course_Length: course_Length,
    });

    if (!enrolledCourse) {
      const enrolledCourseInstance = new enrolledCourseSchema({
        courseId: courseid,
        userId: userId,
        course_Length: course_Length,
      });

      const coursePayment = new coursePaymentSchema({
        userId: req.body.userId,
        courseId: courseid,
        ...req.body,
      });

      await coursePayment.save();
      await enrolledCourseInstance.save();

      // Increment the 'enrolled' count of the course by +1
      course.enrolled += 1;
      await course.save();

      res.status(200).send({
        success: true,
        message: "Enroll Successfully",
        course: { id: course._id, Title: course.C_title },
      });
    } else {
      res.status(200).send({
        success: false,
        message: "You are already enrolled in this Course!",
        course: { id: course._id, Title: course.C_title },
      });
    }
  } catch (error) {
    console.error("Error in enrolling course:", error);
    res
      .status(500)
      .send({ success: false, message: "Failed to enroll in the course" });
  }
};

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
const sendAllCoursesUserController = async (req, res) => {
  const { userId } = req.body;
  try {
    // First, fetch the enrolled courses for the user
    const enrolledCourses = await enrolledCourseSchema.find({ userId });

    // Now, let's retrieve course details for each enrolled course
    const coursesDetails = await Promise.all(
      enrolledCourses.map(async (enrolledCourse) => {
        // Find the corresponding course details using courseId
        const courseDetails = await courseSchema.findOne({
          _id: enrolledCourse.courseId,
        });
        return courseDetails;
      })
    );

    return res.status(200).send({
      success: true,
      data: coursesDetails,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred" });
  }
};

const verifyOtpController = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).send({ message: "Email and OTP are required", success: false });
    }
    const user = await userSchema.findOne({ email });
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
    const user = await userSchema.findOne({ email });
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
  enrolledCourseController,
  sendCourseContentController,
  sendAllCoursesUserController,
  verifyOtpController,
  forgotPasswordController,
  resetPasswordController,
};
