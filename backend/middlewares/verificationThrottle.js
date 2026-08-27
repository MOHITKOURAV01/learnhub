const { readPositiveInteger } = require("./rateLimiter");

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOCK_MS = 15 * 60 * 1000;

/**
 * Per-account failure throttle for credential endpoints.
 *
 * The IP rate limiter alone does not stop a determined attacker, because the
 * six digit codes this project issues can be walked from a pool of addresses.
 * This middleware counts *failed* attempts against the identifier being
 * targeted (the email address) and locks that identifier once the budget is
 * used up, no matter where the requests came from.
 *
 * Success and failure are read off the response body rather than the status
 * code, because the existing controllers answer a wrong OTP with
 * `200 { success: false }`. Wrapping `res.send` keeps the controllers untouched.
 */

function defaultIdentify(req) {
  const email = req.body?.email;

  if (typeof email !== "string" || !email.trim()) {
    return null;
  }

  return email.trim().toLowerCase();
}

function isFailureBody(body) {
  if (!body || typeof body !== "object") {
    return false;
  }

  return body.success === false;
}

function secondsUntil(target, now) {
  return Math.max(1, Math.ceil((target.getTime() - now) / 1000));
}

/**
 * @param {object} options
 * @param {import("mongoose").Model} [options.Attempt] injectable model
 * @param {string} options.scope endpoint family, e.g. "verify-otp"
 * @param {number} [options.maxFailures] failures tolerated per window
 * @param {number} [options.windowMs] how long failures are remembered
 * @param {number} [options.lockMs] how long the identifier stays locked
 * @param {(req: object) => string|null} [options.identify]
 * @param {() => number} [options.now] injectable clock, for tests
 */
function createVerificationThrottle({
  Attempt,
  scope,
  maxFailures = DEFAULT_MAX_FAILURES,
  windowMs = DEFAULT_WINDOW_MS,
  lockMs = DEFAULT_LOCK_MS,
  identify = defaultIdentify,
  now = Date.now,
  logger = console,
} = {}) {
  if (!scope) {
    throw new Error("createVerificationThrottle requires a scope");
  }

  return async function verificationThrottle(req, res, next) {
    const AttemptModel =
      Attempt || require("../schemas/verificationAttemptModel");

    const identifier = identify(req);

    // Nothing to key on (a malformed body). Let the controller reject it; the
    // IP limiter in front of this middleware still applies.
    if (!identifier) {
      return next();
    }

    const currentTime = now();
    let record;

    try {
      record = await AttemptModel.findOne({ scope, identifier });
    } catch (error) {
      // A counter lookup failure must not take the endpoint down. Log it and
      // fall through to the controller — the IP limiter is still in place.
      logger.error("Could not read verification attempts", {
        scope,
        message: error instanceof Error ? error.message : String(error),
      });
      return next();
    }

    if (record?.lockedUntil && record.lockedUntil.getTime() > currentTime) {
      const retryAfterSeconds = secondsUntil(record.lockedUntil, currentTime);

      res.set?.("Retry-After", String(retryAfterSeconds));

      return res.status(429).send({
        success: false,
        message:
          "Too many failed attempts for this account. Please try again later.",
        retryAfterSeconds,
      });
    }

    // The window has rolled over, or the lock has expired — start fresh so a
    // user who failed once yesterday is not one mistake away from a lockout.
    const windowExpired =
      record?.firstFailedAt &&
      currentTime - record.firstFailedAt.getTime() > windowMs;

    const baseFailures = !record || windowExpired ? 0 : record.failedAttempts;

    const originalSend = res.send.bind(res);
    let recorded = false;

    res.send = (body) => {
      // Guard against a handler that calls send twice.
      if (recorded) {
        return originalSend(body);
      }
      recorded = true;

      const outcome = isFailureBody(body)
        ? registerFailure()
        : clearFailures();

      // The counter write is fire-and-forget: the client should not wait on it,
      // and a write failure must not turn a successful login into a 500.
      outcome.catch((error) => {
        logger.error("Could not persist verification attempt", {
          scope,
          message: error instanceof Error ? error.message : String(error),
        });
      });

      return originalSend(body);
    };

    async function registerFailure() {
      const failedAttempts = baseFailures + 1;
      const failedAt = new Date(now());
      const update = {
        failedAttempts,
        lastFailedAt: failedAt,
        firstFailedAt:
          !record || windowExpired ? failedAt : record.firstFailedAt,
        lockedUntil:
          failedAttempts >= maxFailures ? new Date(now() + lockMs) : null,
      };

      await AttemptModel.updateOne(
        { scope, identifier },
        { $set: update },
        { upsert: true },
      );
    }

    async function clearFailures() {
      if (!record) return;

      await AttemptModel.deleteOne({ scope, identifier });
    }

    return next();
  };
}

/**
 * Reads throttle settings from the environment with safe defaults.
 */
function throttleSettingsFromEnv(env = process.env) {
  return {
    maxFailures: readPositiveInteger(env.AUTH_MAX_FAILED_ATTEMPTS, 5),
    windowMs:
      readPositiveInteger(env.AUTH_FAILED_ATTEMPT_WINDOW_MINUTES, 15) *
      60 *
      1000,
    lockMs: readPositiveInteger(env.AUTH_LOCKOUT_MINUTES, 15) * 60 * 1000,
  };
}

module.exports = {
  DEFAULT_LOCK_MS,
  DEFAULT_MAX_FAILURES,
  DEFAULT_WINDOW_MS,
  createVerificationThrottle,
  defaultIdentify,
  isFailureBody,
  throttleSettingsFromEnv,
};
