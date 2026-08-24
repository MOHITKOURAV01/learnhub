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
    // The five fields below are select: false so a bare find() cannot leak
    // them. Read them back with an explicit .select("+field") where a
    // controller genuinely needs the value.
    password: {
      type: String,
      required: [true, "password is required"],
      select: false,
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
    // The three otp* fields and the three resetToken* fields hold a bcrypt
    // hash, an expiry and a failed-attempt count. They used to hold the code
    // itself, so anything with read access to this collection — a backup, a
    // replica, a mongodump in a CI artefact — carried a live credential for
    // every account with a pending code (#95).
    //
    // `select: false` is kept: it stops a stray find() returning even the
    // hash, and the controllers ask for these explicitly where they need them.
    otp: {
      type: String,
      select: false,
    },
    otpExpiry: {
      type: Date,
      select: false,
    },
    // No default: an absent counter means no pending code, and $unset has to
    // mean gone. verifyCredential reads a missing value as zero.
    otpAttempts: {
      type: Number,
      select: false,
    },
    resetToken: {
      type: String,
      select: false,
    },
    resetTokenExpiry: {
      type: Date,
      select: false,
    },
    resetTokenAttempts: {
      type: Number,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Belt and braces for the places that serialise a user document directly, such
// as the login response, where a projection is not involved.
userModel.set("toJSON", {
  transform: (document, plain) => {
    delete plain.password;
    delete plain.otp;
    delete plain.otpExpiry;
    delete plain.otpAttempts;
    delete plain.resetToken;
    delete plain.resetTokenExpiry;
    delete plain.resetTokenAttempts;

    return plain;
  },
});

const userSchema = mongoose.model("user", userModel);

module.exports = userSchema;
