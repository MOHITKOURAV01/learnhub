const crypto = require("crypto");
const bcrypt = require("bcryptjs");

/**
 * One-time codes: issuing, storing and verifying them.
 *
 * Both the registration OTP and the password-reset code used to be generated
 * with `Math.random()` and written to the user document verbatim:
 *
 *   const otp = Math.floor(100000 + Math.random() * 900000).toString();
 *   const newUser = new userSchema({ ..., otp, otpExpiry });
 *
 * `select: false` on the field stops a stray `find()` returning it, and #54
 * removed both from the admin projection, but neither changes what is on disk.
 * A backup, a replica with read-only credentials or a `mongodump` in a CI
 * artefact carries a live credential for every account with a pending code —
 * the holder can complete /verify-otp or /reset-password without ever seeing
 * the mailbox (#95).
 *
 * They are bcrypt hashes now, generated from `crypto.randomInt` rather than
 * `Math.random()`, compared through bcrypt, counted, and invalidated on use,
 * on expiry, on being superseded and on reaching the attempt limit.
 */

const CODE_LENGTH = 6;
const CODE_MIN = 10 ** (CODE_LENGTH - 1);
const CODE_MAX = 10 ** CODE_LENGTH;

const DEFAULT_TTL_MS = 10 * 60 * 1000;

// A 6-digit code is 10^6. #63 proposes an IP-based limiter, which bounds a
// single source; this bounds one account regardless of how many sources the
// guesses come from. The two are complementary and neither replaces the other.
const MAX_ATTEMPTS = 5;

const SALT_ROUNDS = 10;

// A real bcrypt hash of a value no code can be, used to spend the same time on
// the "no such account" path as on a genuine comparison. Without it the
// absence of a bcrypt compare is a timing oracle, which would put back the
// account disclosure the uniform responses exist to remove.
const DECOY_HASH = bcrypt.hashSync("learnhub-decoy-credential", SALT_ROUNDS);

const VERIFICATION = {
  OK: "ok",
  INVALID: "invalid",
  EXPIRED: "expired",
  LOCKED: "locked",
  MISSING: "missing",
};

/**
 * A uniformly distributed code from a cryptographic source.
 *
 * `Math.random()` is not one: V8 seeds xorshift128+ from a source an attacker
 * who has seen a few outputs can work backwards from, and it is not a claim
 * this project should be making about a credential.
 *
 * @returns {string} CODE_LENGTH digits
 */
function generateCode() {
  return String(crypto.randomInt(CODE_MIN, CODE_MAX));
}

/**
 * True when a candidate is shaped like a code at all.
 *
 * Checked before any database work so a malformed submission cannot be told
 * apart from a wrong one by how long the response took.
 *
 * @param {unknown} candidate
 * @returns {boolean}
 */
function isWellFormedCode(candidate) {
  return (
    typeof candidate === "string" &&
    new RegExp(`^\\d{${CODE_LENGTH}}$`).test(candidate.trim())
  );
}

/**
 * Issues a fresh credential.
 *
 * The plaintext is returned once, for the email, and is never persisted.
 *
 * @param {object} [options]
 * @param {number} [options.ttlMs]
 * @param {() => Date} [options.now]
 * @returns {Promise<{code: string, hash: string, expiresAt: Date, attempts: number}>}
 */
async function issueCredential({ ttlMs = DEFAULT_TTL_MS, now = () => new Date() } = {}) {
  const code = generateCode();

  return {
    code,
    hash: await bcrypt.hash(code, SALT_ROUNDS),
    expiresAt: new Date(now().getTime() + ttlMs),
    attempts: 0,
  };
}

/**
 * Spends roughly one bcrypt comparison without revealing anything.
 *
 * Called on the paths where there is nothing to compare against — no account,
 * no pending code — so those cost what a real comparison costs.
 *
 * @returns {Promise<false>}
 */
async function burnComparison() {
  await bcrypt.compare("000000", DECOY_HASH);

  return false;
}

/**
 * Verifies a candidate against a stored credential.
 *
 * Never throws and never distinguishes "no account" from "no pending code":
 * both are MISSING, and the caller answers them the same way it answers
 * INVALID.
 *
 * @param {object} stored
 * @param {string} [stored.hash]
 * @param {Date|number} [stored.expiresAt]
 * @param {number} [stored.attempts]
 * @param {unknown} candidate
 * @param {object} [options]
 * @param {() => Date} [options.now]
 * @returns {Promise<{status: string, attempts: number, shouldClear: boolean}>}
 */
async function verifyCredential(stored, candidate, { now = () => new Date() } = {}) {
  const attempts = Number.isFinite(stored?.attempts) ? stored.attempts : 0;

  if (!stored || !stored.hash) {
    await burnComparison();

    return { status: VERIFICATION.MISSING, attempts, shouldClear: false };
  }

  if (attempts >= MAX_ATTEMPTS) {
    await burnComparison();

    // Reaching the limit destroys the credential rather than parking it: a
    // locked-but-live code is a code somebody can keep working on.
    return { status: VERIFICATION.LOCKED, attempts, shouldClear: true };
  }

  const expiresAt =
    stored.expiresAt instanceof Date
      ? stored.expiresAt.getTime()
      : Number(stored.expiresAt);

  if (!Number.isFinite(expiresAt) || expiresAt <= now().getTime()) {
    await burnComparison();

    return { status: VERIFICATION.EXPIRED, attempts, shouldClear: true };
  }

  if (!isWellFormedCode(candidate)) {
    await burnComparison();

    return {
      status: VERIFICATION.INVALID,
      attempts: attempts + 1,
      shouldClear: attempts + 1 >= MAX_ATTEMPTS,
    };
  }

  const matches = await bcrypt.compare(String(candidate).trim(), stored.hash);

  if (!matches) {
    const nextAttempts = attempts + 1;

    return {
      status: VERIFICATION.INVALID,
      attempts: nextAttempts,
      shouldClear: nextAttempts >= MAX_ATTEMPTS,
    };
  }

  // Single use. A code that has verified once is spent, whatever the caller
  // does next.
  return { status: VERIFICATION.OK, attempts, shouldClear: true };
}

/**
 * True when the outcome must not be distinguishable from any other failure.
 *
 * Everything except OK. Callers use this rather than listing the statuses, so
 * a status added later fails closed.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isFailure(status) {
  return status !== VERIFICATION.OK;
}

module.exports = {
  CODE_LENGTH,
  DEFAULT_TTL_MS,
  MAX_ATTEMPTS,
  SALT_ROUNDS,
  VERIFICATION,
  burnComparison,
  generateCode,
  isFailure,
  isWellFormedCode,
  issueCredential,
  verifyCredential,
};
