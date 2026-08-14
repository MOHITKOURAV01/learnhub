// Baseline security response headers.
//
// Four headers do not justify pulling in helmet and its transitive tree, and
// writing them here keeps the policy visible and testable. The one that matters
// most is X-Content-Type-Options: /uploads serves user-supplied files from the
// same origin as the API, so a sniffed content type there is a real XSS vector.

const BASE_HEADERS = {
  // Stop browsers guessing a content type for uploaded files.
  "X-Content-Type-Options": "nosniff",
  // The API has no pages meant to be framed.
  "X-Frame-Options": "DENY",
  // Do not leak full API URLs (which contain ids) to third party sites.
  "Referrer-Policy": "no-referrer",
  // This API needs none of these device features.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // Legacy header, still honoured by some corporate proxies.
  "X-DNS-Prefetch-Control": "off",
};

// A year, the minimum browsers accept for preload consideration.
const HSTS_MAX_AGE_SECONDS = 31_536_000;

function isSecureRequest(req) {
  if (req.secure) return true;

  // Behind a load balancer Express only sees plain HTTP unless `trust proxy`
  // is on, so fall back to the forwarded header.
  return String(req.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase() === "https";
}

/**
 * @param {object} [options]
 * @param {boolean} [options.enableHsts] send Strict-Transport-Security on
 *   HTTPS requests. Off in development, where everything is plain HTTP.
 */
function createSecurityHeaders({ enableHsts = false } = {}) {
  return function securityHeaders(req, res, next) {
    for (const [header, value] of Object.entries(BASE_HEADERS)) {
      res.set(header, value);
    }

    // Only meaningful over HTTPS, and actively harmful to set on a local
    // http:// origin because the browser will pin it for a year.
    if (enableHsts && isSecureRequest(req)) {
      res.set(
        "Strict-Transport-Security",
        `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
      );
    }

    next();
  };
}

/**
 * HSTS is enabled outside development by default, and can be forced either way
 * with ENABLE_HSTS for deployments that terminate TLS differently.
 */
function securityHeaderSettingsFromEnv(env = process.env) {
  if (env.ENABLE_HSTS === "true") return { enableHsts: true };
  if (env.ENABLE_HSTS === "false") return { enableHsts: false };

  return { enableHsts: env.NODE_ENV === "production" };
}

module.exports = {
  BASE_HEADERS,
  HSTS_MAX_AGE_SECONDS,
  createSecurityHeaders,
  isSecureRequest,
  securityHeaderSettingsFromEnv,
};
