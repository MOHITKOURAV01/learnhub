// Restores the authenticated id on the request body after a body parser has
// replaced it.
//
// authMiddleware publishes the caller two ways: `req.user`, and a copy of the
// id at `req.body.userId` that the older controllers read. Multer begins a
// multipart parse with
//
//   req.body = Object.create(null)
//
// so on a multipart route the second one is silently dropped and repopulated
// from the form — which is how POST /api/user/addcourse ended up letting the
// client name the owner of the course it was creating.
//
// The controller for that route reads `req.user` directly now and does not need
// this. It is mounted anyway, immediately after the upload, so that the next
// multipart route added to this project cannot inherit the same trap: after
// this middleware `req.body.userId` is the token's id again, or is absent if
// there is no authenticated caller.

/**
 * @param {object} [options]
 * @param {string} [options.field] body key to write, defaults to "userId"
 */
function createPreserveAuthIdentity({ field = "userId" } = {}) {
  return function preserveAuthIdentity(req, res, next) {
    const identity = req.user?._id ?? req.user?.id;

    if (identity === undefined || identity === null) {
      // No authenticated caller. Removing the key matters as much as setting
      // it: leaving a client-supplied `userId` in place would be the bug.
      if (req.body && typeof req.body === "object") {
        delete req.body[field];
      }

      return next();
    }

    // Multer's body has a null prototype, which assignment handles fine.
    if (!req.body || typeof req.body !== "object") {
      req.body = {};
    }

    req.body[field] = String(identity);

    return next();
  };
}

module.exports = {
  createPreserveAuthIdentity,
  preserveAuthIdentity: createPreserveAuthIdentity(),
};
