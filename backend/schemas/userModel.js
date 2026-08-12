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
    },
    // The five fields below are select: false so a bare find() cannot leak
    // them. Read them back with an explicit .select("+field") where a
    // controller genuinely needs the value.
    password: {
      type: String,
      required: [true, "password is required"],
      select: false,
    },
    type: {
      type: String,
      required: [true, "type is required"],
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
    delete plain.resetToken;
    delete plain.resetTokenExpiry;

    return plain;
  },
});

const userSchema = mongoose.model("user", userModel);

module.exports = userSchema;
