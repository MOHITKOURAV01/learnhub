// Central error handler.
//
// The previous inline handler in app.js answered every non-Multer failure with
// a bare 500 and never logged `err`, so a production incident left no stack, no
// route and no message behind. It also could not tell a client mistake (a bad
// ObjectId, a validation failure, malformed JSON) apart from a server fault.

const GENERIC_MESSAGE = "Internal server error";

/**
 * Maps a thrown error onto an HTTP status and a client-safe message.
 *
 * Only errors we deliberately recognise get their message forwarded. Anything
 * else is reported generically so internal details (driver errors, file paths,
 * connection strings) never reach the client.
 */
function classifyError(err) {
  if (!err) {
    return { status: 500, message: GENERIC_MESSAGE, expected: false };
  }

  // Multer rejects oversized or unexpected uploads. Already handled before this
  // change; kept so behaviour does not regress.
  if (err.name === "MulterError") {
    return {
      status: 400,
      message: err.message || "Upload failed",
      expected: true,
    };
  }

  // body-parser marks malformed JSON and oversized bodies with a `type`.
  if (err.type === "entity.parse.failed") {
    return { status: 400, message: "Malformed JSON body", expected: true };
  }

  if (err.type === "entity.too.large") {
    return { status: 413, message: "Request body is too large", expected: true };
  }

  // Mongoose: the client sent an id that is not an ObjectId.
  if (err.name === "CastError") {
    return {
      status: 400,
      message: `Invalid value for ${err.path || "parameter"}`,
      expected: true,
    };
  }

  if (err.name === "ValidationError") {
    const details = Object.values(err.errors || {})
      .map((detail) => detail.message)
      .filter(Boolean);

    return {
      status: 400,
      message: details.length > 0 ? details.join(", ") : "Validation failed",
      expected: true,
    };
  }

  // A CORS rejection or an explicitly thrown HttpError carrying a status.
  const explicitStatus = err.status || err.statusCode;
  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus < 500) {
    return {
      status: explicitStatus,
      message: err.message || "Request rejected",
      expected: true,
    };
  }

  return { status: 500, message: GENERIC_MESSAGE, expected: false };
}

/**
 * @param {object} [options]
 * @param {Console} [options.logger]
 */
function createErrorHandler({ logger = console } = {}) {
  // Express identifies an error handler by its four-argument signature, so
  // `next` has to stay in the list even though it is only used for the
  // headers-sent case.
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) {
      return next(err);
    }

    const { status, message, expected } = classifyError(err);

    const context = {
      method: req.method,
      path: req.originalUrl || req.url,
      status,
      error: err instanceof Error ? err.message : String(err),
    };

    // Client mistakes are noise at error level; genuine faults get the stack.
    if (expected) {
      logger.warn("Request rejected", context);
    } else {
      logger.error("Unhandled request failure", {
        ...context,
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    return res.status(status).json({ success: false, message });
  };
}

module.exports = {
  GENERIC_MESSAGE,
  classifyError,
  createErrorHandler,
};
