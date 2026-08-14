const mongoose = require("mongoose");

const userModel = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "name is required"],
      set: function (value) {
        return value.charAt(0).toUpperCase() + value.slice(1);
      },
    },
    email: {
      type: String,
      required: [true, "email is required"],
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "password is required"],
    },
    // roleMiddleware authorises on this field, so the set of accepted values is
    // closed here rather than left free-form. "admin" stays valid because
    // seed.js creates one and roleMiddleware already recognises it, but
    // registration will not hand it out: validateRegistration only accepts
    // student and teacher.
    type: {
      type: String,
      required: [true, "type is required"],
      lowercase: true,
      trim: true,
      enum: {
        values: ["student", "teacher", "admin"],
        message: "Account type must be one of: student, teacher, admin",
      },
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    otp: {
      type: String,
    },
    otpExpiry: {
      type: Date,
    },
    resetToken: {
      type: String,
    },
    resetTokenExpiry: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

const userSchema = mongoose.model("user", userModel);

module.exports = userSchema;
