const sendEmailDefault = require("../utils/sendEmail");
const userSchemaDefault = require("../schemas/userModel");

const {
  buildVerificationEmail,
  generateOtp,
  otpExpiryFrom,
  secondsUntilResend,
} = require("../utils/otpCodes");

// An account that never completed verification used to be a dead end. The code
// expires after ten minutes, registering again answers "User already exists",
// logging in answers "Email is not verified", and nothing anywhere issues a
// second code. The only recovery was a maintainer deleting the row by hand.
//
// This module owns issuing a code, so registration and the resend route stay in
// step, and the cooldown is applied to both.

// The same sentence is returned whether or not the address is registered, and
// whether or not it was already verified. A resend route that says "no such
// account" is an account-enumeration oracle.
const NEUTRAL_RESPONSE =
  "If that address needs verifying, a new code is on its way.";

// Addresses are stored lowercase by the schema setter, so the lookup has to be
// lowercased too or a differently cased address finds nothing.
const lookupByEmail = (value) => ({
  email: typeof value === "string" ? value.trim().toLowerCase() : "",
});

/**
 * Writes a fresh code onto a user and mails it, unless the cooldown blocks it.
 *
 * The user document is mutated and saved by this function, so the caller does
 * not need to remember which of the three fields to set.
 *
 * @param {object} options
 * @param {object} options.user a Mongoose user document
 * @param {Function} [options.sendMail]
 * @param {number} [options.nowMs]
 * @returns {Promise<{ sent: boolean, retryAfterSeconds: number, otp?: string }>}
 */
async function issueVerificationOtp({
  user,
  sendMail = sendEmailDefault,
  nowMs = Date.now(),
}) {
  const retryAfterSeconds = secondsUntilResend(user.otpLastSentAt, nowMs);

  if (retryAfterSeconds > 0) {
    return { sent: false, retryAfterSeconds };
  }

  const otp = generateOtp();

  user.otp = otp;
  user.otpExpiry = otpExpiryFrom(nowMs);
  user.otpLastSentAt = new Date(nowMs);

  await user.save();

  await sendMail({ to: user.email, ...buildVerificationEmail(otp) });

  return { sent: true, retryAfterSeconds: 0, otp };
}

/**
 * POST /api/user/resend-otp
 *
 * Answers identically for an unknown address, an already-verified account and a
 * successful send. The only thing that varies is `retryAfterSeconds`, which a
 * caller can only learn for an address they are already able to hit the
 * cooldown on.
 */
function createResendOtpController({
  UserModel = userSchemaDefault,
  sendMail = sendEmailDefault,
  now = () => Date.now(),
  logger = console,
} = {}) {
  return async function resendOtpController(req, res) {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).send({
        success: false,
        message: "Email is required",
      });
    }

    try {
      const user = await UserModel.findOne(lookupByEmail(email)).select(
        "+otp +otpExpiry +otpLastSentAt",
      );

      // Unknown address, or one that is already verified: same answer, no mail.
      if (!user || user.isVerified) {
        return res.status(200).send({
          success: true,
          message: NEUTRAL_RESPONSE,
        });
      }

      const result = await issueVerificationOtp({
        user,
        sendMail,
        nowMs: now(),
      });

      if (!result.sent) {
        return res.status(429).send({
          success: false,
          message: `Please wait ${result.retryAfterSeconds}s before requesting another code.`,
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }

      return res.status(200).send({
        success: true,
        message: NEUTRAL_RESPONSE,
      });
    } catch (error) {
      logger.error("Failed to resend verification code:", error);

      return res.status(500).send({
        success: false,
        message: "Could not send a verification code right now.",
      });
    }
  };
}

const resendOtpController = (req, res) =>
  createResendOtpController()(req, res);

module.exports = {
  NEUTRAL_RESPONSE,
  createResendOtpController,
  issueVerificationOtp,
  resendOtpController,
};
