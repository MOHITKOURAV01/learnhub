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
    // The address is the account's identity: login, /forgot-password,
    // /reset-password and /verify-otp all resolve a user by it. Until this
    // index existed the only thing preventing a second row on the same address
    // was a findOne() in registerController, which is a read and a write with
    // nothing in between, so two concurrent registrations both won.
    //
    // lowercase + trim are applied by the setter so the stored value always
    // matches what normalizeEmail() produces on the lookup side.
    email: {
      type: String,
      required: [true, "email is required"],
      lowercase: true,
      trim: true,
      unique: true,
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
    otp: {
      type: String,
      select: false,
    },
    otpExpiry: {
      type: Date,
      select: false,
    },
    // When the last verification mail went out. The resend cooldown is derived
    // from this rather than from anything the client sends, so it cannot be
    // stepped around by clearing storage or calling the API directly.
    otpLastSentAt: {
      type: Date,
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
    delete plain.otpLastSentAt;
    delete plain.resetToken;
    delete plain.resetTokenExpiry;

    return plain;
  },
});

const userSchema = mongoose.model("user", userModel);

module.exports = userSchema;
