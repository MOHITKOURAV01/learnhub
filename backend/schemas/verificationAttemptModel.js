const mongoose = require("mongoose");

// Failure counters for credential endpoints, keyed by scope + identifier.
//
// This is deliberately persisted rather than held in memory: the whole point is
// to stop an attacker who rotates source addresses, so the counter has to
// follow the account being attacked, not the client doing the attacking. It
// also has to survive a restart, otherwise `pm2 restart` clears the lockout.
const verificationAttemptSchema = new mongoose.Schema(
  {
    // Which endpoint family the counter belongs to, e.g. "verify-otp".
    scope: {
      type: String,
      required: true,
      trim: true,
    },
    // The account under attack — an email address in every current caller.
    identifier: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    failedAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    firstFailedAt: {
      type: Date,
      default: null,
    },
    lastFailedAt: {
      type: Date,
      default: null,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

verificationAttemptSchema.index(
  { scope: 1, identifier: 1 },
  { unique: true },
);

// Counters are worthless once they are old enough that the window has passed
// several times over. A TTL index keeps the collection from growing without
// bound; 24 hours is far longer than any lockout this project configures.
verificationAttemptSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 24 * 60 * 60 },
);

module.exports = mongoose.model(
  "verificationAttempt",
  verificationAttemptSchema,
);
