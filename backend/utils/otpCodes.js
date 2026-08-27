const crypto = require("crypto");

// Everything about the verification code lives here, so registration and the
// resend route cannot drift apart on length, lifetime or cooldown.

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes, matching the mail copy
const RESEND_COOLDOWN_MS = 60 * 1000; // one mail per address per minute

/**
 * Generates the verification code.
 *
 * `Math.floor(100000 + Math.random() * 900000)` was the original. Math.random
 * is not a CSPRNG, and this value is the only thing standing between an
 * attacker and a verified account, so it comes from crypto here. The range is
 * unchanged, so the code is still exactly six digits and never starts with a
 * zero.
 *
 * @returns {string}
 */
const generateOtp = () => String(crypto.randomInt(100000, 1000000));

/**
 * @param {number} [nowMs]
 * @returns {Date} when a code issued now stops being valid
 */
const otpExpiryFrom = (nowMs = Date.now()) => new Date(nowMs + OTP_TTL_MS);

/**
 * @param {Date|string|number|null|undefined} expiry
 * @param {number} [nowMs]
 * @returns {boolean} true when there is no usable code
 */
const isOtpExpired = (expiry, nowMs = Date.now()) => {
  if (!expiry) return true;

  const expiresAt = new Date(expiry).getTime();

  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
};

/**
 * How long the caller must wait before another mail may be sent.
 *
 * A resend route with no cooldown is a free mail relay pointed at any address
 * an attacker chooses, so the answer is derived from the last send rather than
 * from anything the client tells us.
 *
 * @param {Date|string|number|null|undefined} lastSentAt
 * @param {number} [nowMs]
 * @returns {number} whole seconds remaining, 0 when a send is allowed now
 */
const secondsUntilResend = (lastSentAt, nowMs = Date.now()) => {
  if (!lastSentAt) return 0;

  const sentAt = new Date(lastSentAt).getTime();

  if (!Number.isFinite(sentAt)) return 0;

  // A clock that moved backwards, or a timestamp from the future, should not
  // lock the address out for hours.
  if (sentAt > nowMs) return Math.ceil(RESEND_COOLDOWN_MS / 1000);

  const elapsed = nowMs - sentAt;

  if (elapsed >= RESEND_COOLDOWN_MS) return 0;

  return Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
};

/**
 * @param {Date|string|number|null|undefined} lastSentAt
 * @param {number} [nowMs]
 * @returns {boolean}
 */
const canResend = (lastSentAt, nowMs = Date.now()) =>
  secondsUntilResend(lastSentAt, nowMs) === 0;

/**
 * The verification mail, in one place. Registration and resend send the same
 * thing, so the copy is not duplicated across two controllers.
 *
 * @param {string} otp
 * @returns {{ subject: string, text: string, html: string }}
 */
const buildVerificationEmail = (otp) => ({
  subject: "Verify your LearnHub Account",
  text: `Your OTP code for verification is: ${otp}. This code is valid for 10 minutes.`,
  html:
    `<p>Your OTP code for verification is: <strong>${otp}</strong>.</p>` +
    `<p>This code is valid for 10 minutes.</p>`,
});

module.exports = {
  OTP_LENGTH,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  buildVerificationEmail,
  canResend,
  generateOtp,
  isOtpExpired,
  otpExpiryFrom,
  secondsUntilResend,
};
