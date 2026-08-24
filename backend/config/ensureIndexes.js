const mongoose = require("mongoose");

// Mongoose builds declared indexes in the background on first use, and when a
// build fails — which is exactly what happens the first time `email_unique`
// meets a database that already holds duplicates — the failure is emitted on
// the model and, by default, nobody is listening. The server comes up looking
// healthy while the constraint it depends on silently does not exist.
//
// Building them here instead means a failure is reported once, in one place,
// with the command that fixes it.

const DUPLICATE_KEY = 11000;

/**
 * Turns a failed index build into a message an operator can act on.
 *
 * @param {string} modelName
 * @param {Error & { code?: number, keyValue?: object }} error
 * @returns {string}
 */
function describeIndexFailure(modelName, error) {
  if (error?.code !== DUPLICATE_KEY) {
    return `Could not build indexes for ${modelName}: ${error?.message || error}`;
  }

  const collided = error.keyValue
    ? ` (first collision: ${JSON.stringify(error.keyValue)})`
    : "";

  if (modelName === "user") {
    return (
      `Could not build the unique index on users.email because the ` +
      `collection already contains duplicate addresses${collided}. ` +
      `Run "npm run db:dedupe-emails -- --dry-run" to see what would be ` +
      `merged, then "npm run db:dedupe-emails" to apply it, then restart.`
    );
  }

  return (
    `Could not build a unique index for ${modelName}: the collection already ` +
    `contains duplicates${collided}.`
  );
}

/**
 * Builds every declared index and reports what happened.
 *
 * Resolves rather than rejects on failure so a single unbuildable index cannot
 * take the whole API offline; the caller decides how loud to be about it.
 *
 * @param {object} [options]
 * @param {object} [options.connection] a Mongoose connection, for tests
 * @param {object} [options.logger]
 * @returns {Promise<{ built: string[], failed: Array<{ model: string, message: string }> }>}
 */
async function ensureIndexes({
  connection = mongoose.connection,
  logger = console,
} = {}) {
  const built = [];
  const failed = [];

  const models = Object.values(connection.models || {});

  for (const model of models) {
    try {
      await model.createIndexes();
      built.push(model.modelName);
    } catch (error) {
      const message = describeIndexFailure(model.modelName, error);
      failed.push({ model: model.modelName, message });
      logger.error(message);
    }
  }

  if (failed.length === 0) {
    logger.log(`Indexes verified for ${built.length} collections`);
  }

  return { built, failed };
}

module.exports = {
  DUPLICATE_KEY,
  describeIndexFailure,
  ensureIndexes,
};
