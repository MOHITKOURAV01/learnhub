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
  VERIFICATION,
  burnComparison,
  issueCredential,
  verifyCredential,
} = require("../utils/otpCredentials");
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

    // The code is generated from crypto.randomInt and only the bcrypt hash of
    // it is persisted. The plaintext exists for the length of this handler and
    // goes to the mailbox; it is never written to the database, so a copy of
    // the collection is not a set of live credentials (#95).
    const credential = await issueCredential();

    const newUser = new userSchema({
      name: value.name,
      email: value.email,
      password: hashedPassword,
      type: value.type,
      isVerified: false,
      otp: credential.hash,
      otpExpiry: credential.expiresAt,
      otpAttempts: 0,
    });
    await newUser.save();

    // Send email
    await sendEmail({
      to: value.email,
      subject: "Verify your LearnHub Account",
      text: `Your OTP code for verification is: ${credential.code}. This code is valid for 10 minutes.`,
      html: `<p>Your OTP code for verification is: <strong>${credential.code}</strong>.</p><p>This code is valid for 10 minutes.</p>`,
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
    // password is select: false on the schema, so ask for it explicitly.
    const user = await userSchema
      .findOne({ email: req.body.email })
      .select("+password");
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

// One answer for every way verification can fail: no such address, no pending
// code, the wrong code, an expired code, too many attempts. Distinguishing them
// is what let an unauthenticated caller confirm or deny any email address in a
// single request — forgotPasswordController in this same file already answers
// uniformly, and these two did not (#95).
const OTP_FAILURE_MESSAGE = "Invalid or expired OTP";
const RESET_FAILURE_MESSAGE = "Invalid or expired reset token/OTP";

/**
 * Clears a credential and its attempt counter.
 *
 * Used on every terminal outcome — spent, expired, or locked out — so a code
 * cannot be worked on after it has stopped being usable.
 */
const clearCredential = async (user, prefix) => {
  await userSchema.updateOne(
    { _id: user._id },
    {
      $unset: {
        [prefix]: "",
        [`${prefix}Expiry`]: "",
        [`${prefix}Attempts`]: "",
      },
    },
  );
};

const verifyOtpController = async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      return res.status(400).send({ message: "Email and OTP are required", success: false });
    }

    const user = await userSchema
      .findOne({ email })
      .select("+otp +otpExpiry +otpAttempts");

    if (!user) {
      // Same status, same message, and one bcrypt comparison's worth of time —
      // otherwise the absence of a comparison is the new oracle.
      await burnComparison();

      return res
        .status(400)
        .send({ message: OTP_FAILURE_MESSAGE, success: false });
    }

    if (user.isVerified) {
      // Verified accounts should not be carrying a live code around.
      if (user.otp) {
        await clearCredential(user, "otp");
      }

      return res.status(200).send({ message: "User already verified", success: true });
    }

    const result = await verifyCredential(
      { hash: user.otp, expiresAt: user.otpExpiry, attempts: user.otpAttempts },
      otp,
    );

    if (result.status !== VERIFICATION.OK) {
      if (result.shouldClear) {
        await clearCredential(user, "otp");
      } else {
        await userSchema.updateOne(
          { _id: user._id },
          { $set: { otpAttempts: result.attempts } },
        );
      }

      return res
        .status(400)
        .send({ message: OTP_FAILURE_MESSAGE, success: false });
    }

    await userSchema.updateOne(
      { _id: user._id },
      {
        $set: { isVerified: true },
        $unset: { otp: "", otpExpiry: "", otpAttempts: "" },
      },
    );

    return res.status(200).send({ message: "Email verified successfully", success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).send({ success: false, message: "Unable to verify the code" });
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
    
    // Issuing a new code supersedes any previous one, and resets the attempt
    // counter with it — otherwise a locked-out account could never recover.
    const credential = await issueCredential();

    await userSchema.updateOne(
      { _id: user._id },
      {
        $set: {
          resetToken: credential.hash,
          resetTokenExpiry: credential.expiresAt,
          resetTokenAttempts: 0,
        },
      },
    );

    await sendEmail({
      to: email,
      subject: "LearnHub Password Reset Request",
      text: `Your password reset code is: ${credential.code}. This code is valid for 10 minutes.`,
      html: `<p>Your password reset code is: <strong>${credential.code}</strong>.</p><p>This code is valid for 10 minutes.</p>`,
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
      .select("+resetToken +resetTokenExpiry +resetTokenAttempts");

    if (!user) {
      // 404 "User not found" here confirmed the address to anyone who asked.
      await burnComparison();

      return res
        .status(400)
        .send({ message: RESET_FAILURE_MESSAGE, success: false });
    }

    const result = await verifyCredential(
      {
        hash: user.resetToken,
        expiresAt: user.resetTokenExpiry,
        attempts: user.resetTokenAttempts,
      },
      token,
    );

    if (result.status !== VERIFICATION.OK) {
      if (result.shouldClear) {
        await clearCredential(user, "resetToken");
      } else {
        await userSchema.updateOne(
          { _id: user._id },
          { $set: { resetTokenAttempts: result.attempts } },
        );
      }

      return res
        .status(400)
        .send({ message: RESET_FAILURE_MESSAGE, success: false });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Holding the code proves control of the mailbox, so the address is marked
    // verified here. This was already the behaviour; it is stated now rather
    // than left as an unexplained side effect.
    await userSchema.updateOne(
      { _id: user._id },
      {
        $set: { password: hashedPassword, isVerified: true },
        $unset: {
          resetToken: "",
          resetTokenExpiry: "",
          resetTokenAttempts: "",
          // A password change ends any pending verification code too.
          otp: "",
          otpExpiry: "",
          otpAttempts: "",
        },
      },
    );

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
