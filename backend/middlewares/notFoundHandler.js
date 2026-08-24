// Unknown routes used to fall through to Express's default handler, which
// answers with an HTML "Cannot GET /api/user/typo" page. Every client in this
// repo reads `res.data.success`, so a typo'd endpoint surfaced as a JSON parse
// failure rather than a clean error.

/**
 * @param {object} [options]
 * @param {string} [options.apiPrefix] paths under this prefix always get JSON
 */
function createNotFoundHandler({ apiPrefix = "/api" } = {}) {
  return function notFoundHandler(req, res, next) {
    // Anything already answered by an earlier handler is not our business.
    if (res.headersSent) {
      return next();
    }

    const isApiRequest = req.path.startsWith(apiPrefix);

    // Non-API paths (the static /uploads mount, for instance) keep Express's
    // default behaviour so a missing file still looks like a missing file.
    if (!isApiRequest) {
      return next();
    }

    return res.status(404).json({
      success: false,
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    });
  };
}

module.exports = {
  createNotFoundHandler,
  notFoundHandler: createNotFoundHandler(),
};
