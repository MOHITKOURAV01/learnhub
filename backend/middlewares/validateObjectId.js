const mongoose = require("mongoose");

/**
 * Rejects a request whose route parameter is not a valid Mongo ObjectId.
 *
 * Without this the id goes straight into a Mongoose query and a malformed
 * value surfaces as a CastError, which the generic error handler reports as a
 * 500. The caller sent a bad request, so it should read as one.
 *
 * @param {string} paramName route parameter to validate, for example "userid"
 * @param {string} [label] human readable name used in the error message
 */
const validateObjectId = (paramName, label) => {
  const readableName = label || paramName;

  return (req, res, next) => {
    const value = req.params?.[paramName];

    if (!value || !mongoose.isValidObjectId(value)) {
      return res.status(400).send({
        success: false,
        message: `Invalid ${readableName}`,
      });
    }

    return next();
  };
};

module.exports = validateObjectId;
