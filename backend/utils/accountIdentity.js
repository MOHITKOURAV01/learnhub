// Email is the identity of an account, but nothing in the app treated it that
// way. Registration lowercased it through validateRegistration, while every
// lookup afterwards passed `req.body.email` through unchanged, so
// "User@Example.com" and "user@example.com" resolved to different rows — or to
// no row at all. There was no unique index behind any of it either, so two
// concurrent registrations both passed the `findOne` pre-check and both wrote.
//
// This module holds the two pieces that fix depends on: one normalisation used
// by every lookup, and one reader for the duplicate-key error the index now
// raises.

/**
 * Normalises an address for storage and for lookup.
 *
 * Deliberately conservative: trim and lowercase only. Nothing here strips dots
 * or plus-tags, because two people at a self-hosted domain may genuinely own
 * `a.b@` and `ab@`, and collapsing them would merge unrelated accounts.
 *
 * @param {unknown} value
 * @returns {string} the normalised address, or "" when there is nothing usable
 */
const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/**
 * Builds the filter used to look an account up by address.
 *
 * Every caller should go through this rather than writing `{ email }` inline,
 * so a future change to normalisation cannot be applied in some places and
 * missed in others.
 *
 * An unusable value (missing, an object posted in place of a string, a
 * whitespace-only string) yields `{ email: "" }`, which matches nothing because
 * the field is `required` and so can never be stored empty. Returning null here
 * instead would be a trap: `findOne(null)` is `findOne({})` in Mongoose and
 * would hand back an arbitrary account.
 *
 * @param {unknown} value
 * @returns {{ email: string }}
 */
const buildEmailFilter = (value) => ({ email: normalizeEmail(value) });

/**
 * MongoDB reports a unique-index violation as write error 11000. Mongoose
 * surfaces it with `code` on the error itself for `save()` and `create()`, and
 * nested under `writeErrors` for bulk paths.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
const isDuplicateKeyError = (error) => {
  if (!error || typeof error !== "object") return false;

  if (error.code === 11000) return true;

  const writeErrors = Array.isArray(error.writeErrors) ? error.writeErrors : [];

  return writeErrors.some((writeError) => writeError?.code === 11000);
};

/**
 * Names the fields that collided, so a controller can answer "that email is
 * taken" rather than a generic 500.
 *
 * Driver versions differ in what they attach: `keyPattern` and `keyValue` are
 * present on recent ones, older ones only put the index name in the message.
 *
 * @param {unknown} error
 * @returns {string[]} field names, possibly empty
 */
const duplicateKeyFields = (error) => {
  if (!isDuplicateKeyError(error)) return [];

  const candidates = [error, ...(error.writeErrors || [])];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    const pattern = candidate.keyPattern || candidate.err?.keyPattern;
    if (pattern && typeof pattern === "object") {
      return Object.keys(pattern);
    }

    const value = candidate.keyValue || candidate.err?.keyValue;
    if (value && typeof value === "object") {
      return Object.keys(value);
    }
  }

  // Last resort: "E11000 duplicate key error collection: db.users index:
  // email_1 dup key: { email: "a@b.c" }"
  const match = /index:\s*([A-Za-z0-9_.$]+)/.exec(String(error.message || ""));
  if (!match) return [];

  return match[1]
    .replace(/_-?\d+$/, "")
    .split("_")
    .filter(Boolean);
};

/**
 * @param {unknown} error
 * @param {string} field
 * @returns {boolean} true when `field` is one of the colliding keys
 */
const isDuplicateOn = (error, field) =>
  duplicateKeyFields(error).includes(field);

module.exports = {
  buildEmailFilter,
  duplicateKeyFields,
  isDuplicateKeyError,
  isDuplicateOn,
  normalizeEmail,
};
