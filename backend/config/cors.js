// CORS policy for the API.
//
// `cors()` with no arguments reflects whatever Origin the caller sends, which
// means any page on the internet can read authenticated responses from a
// logged-in user's browser. `.env.example` has always carried a FRONTEND_URL
// allowlist; this module is what finally reads it.

const DEFAULT_ORIGINS = ["http://localhost:5173", "http://localhost:5174"];

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ALLOWED_HEADERS = ["Content-Type", "Authorization"];

/**
 * Splits the comma separated FRONTEND_URL value into a clean origin list.
 * Trailing slashes are stripped so `http://localhost:5173/` and
 * `http://localhost:5173` are treated as the same origin.
 */
function parseAllowedOrigins(value, fallback = DEFAULT_ORIGINS) {
  if (typeof value !== "string" || !value.trim()) {
    return [...fallback];
  }

  const origins = value
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return origins.length > 0 ? origins : [...fallback];
}

function normalizeOrigin(origin) {
  if (typeof origin !== "string") return "";

  return origin.trim().replace(/\/+$/, "");
}

/**
 * Decides whether a given Origin header is allowed.
 *
 * A missing Origin is allowed on purpose: curl, server-to-server calls, health
 * checks and same-origin navigations do not send one, and CORS is a browser
 * mechanism that has nothing to say about those.
 */
function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;

  return allowedOrigins.includes(normalizeOrigin(origin));
}

/**
 * Builds the options object handed to the `cors` package.
 *
 * @param {object} [env] process.env or a stub
 * @returns {import("cors").CorsOptions}
 */
function buildCorsOptions(env = process.env) {
  const allowedOrigins = parseAllowedOrigins(env.FRONTEND_URL);

  return {
    origin(origin, callback) {
      if (isOriginAllowed(origin, allowedOrigins)) {
        return callback(null, true);
      }

      // Answering with `false` rather than an Error keeps the response a clean
      // CORS rejection instead of a 500 from the error handler.
      return callback(null, false);
    },
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    credentials: true,
    // Cache the preflight result so browsers stop re-asking on every request.
    maxAge: 600,
  };
}

module.exports = {
  ALLOWED_HEADERS,
  ALLOWED_METHODS,
  DEFAULT_ORIGINS,
  buildCorsOptions,
  isOriginAllowed,
  normalizeOrigin,
  parseAllowedOrigins,
};
