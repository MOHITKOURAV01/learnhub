const mongoose = require("mongoose");

const coursePaymentModel = mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "course",
    },
    // Only a summary is kept. cardnumber and cvvcode used to be declared here
    // and were written straight from the request body; a CVV must not be
    // stored after authorisation and the full number is not needed to show a
    // payment record in the admin dashboard.
    cardDetails: {
      cardholdername: {
        type: String,
      },
      cardLast4: {
        type: String,
        maxlength: 4,
      },
      expmonthyear: {
        type: String,
      },
    },
    amount: {
      type: String,
    },
    status: {
      type: String,
      default: "enrolled",
    },
  },
  {
    timestamps: true,
    // strict: false meant any undeclared key posted to the enrollment route
    // was persisted verbatim. Unknown keys are now dropped.
    strict: true,
  }
);

// The admin payment dashboard sorts by createdAt and filters by user, and a
// user's own history is read by userId. Neither field was indexed, so both were
// collection scans.
coursePaymentModel.index({ userId: 1, createdAt: -1 });
coursePaymentModel.index({ courseId: 1, createdAt: -1 });
coursePaymentModel.index({ createdAt: -1 });

const coursePaymentSchema = mongoose.model("coursePayment", coursePaymentModel);

module.exports = coursePaymentSchema;
