// Registration used to build the user document from { ...req.body }, so every
// schema field was client-writable. The one that mattered was `type`, which
// roleMiddleware authorises on, so a request could hand itself the admin role.
// Everything the client is allowed to set now goes through this module.

const SELF_ASSIGNABLE_ROLES = Object.freeze(["student", "teacher"]);

const MIN_PASSWORD_LENGTH = 6;
const MAX_NAME_LENGTH = 60;
const MAX_EMAIL_LENGTH = 254;

// Deliberately permissive. The OTP mail is the real proof of ownership; this
// only rejects values that are obviously not addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const asTrimmedString = (value) =>
  typeof value === "string" ? value.trim() : "";

/**
 * Validates a registration payload and returns only the fields a client may
 * set. Never returns `isVerified`, `otp` or any reset field.
 *
 * @param {object} body raw request body
 * @returns {{ valid: boolean, errors: object, value?: object }}
 */
const validateRegistration = (body = {}) => {
  const errors = {};

  const name = asTrimmedString(body.name);
  const email = asTrimmedString(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const type = asTrimmedString(body.type).toLowerCase();

  if (!name) {
    errors.name = "Name is required";
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `Name must be at most ${MAX_NAME_LENGTH} characters`;
  }

  if (!email) {
    errors.email = "Email is required";
  } else if (email.length > MAX_EMAIL_LENGTH) {
    errors.email = `Email must be at most ${MAX_EMAIL_LENGTH} characters`;
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Email is not valid";
  }

  if (!password) {
    errors.password = "Password is required";
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  if (!type) {
    errors.type = "Account type is required";
  } else if (!SELF_ASSIGNABLE_ROLES.includes(type)) {
    // The message names the accepted values rather than the rejected one, so
    // the response does not confirm that "admin" is a real role.
    errors.type = `Account type must be one of: ${SELF_ASSIGNABLE_ROLES.join(", ")}`;
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    value: { name, email, password, type },
  };
};

/**
 * Turns a validation result into a single readable sentence for the client,
 * which expects a `message` string.
 */
const formatValidationMessage = (errors = {}) =>
  Object.values(errors).join(". ");

module.exports = {
  EMAIL_PATTERN,
  MIN_PASSWORD_LENGTH,
  SELF_ASSIGNABLE_ROLES,
  formatValidationMessage,
  validateRegistration,
};
