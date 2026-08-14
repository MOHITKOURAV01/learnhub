// A small sliding-window rate limiter with no external dependency.
//
// The backend runs as a single process today, so an in-memory window is enough
// and keeps the request path free of an extra database round trip. It is the
// first of two layers: this one caps how fast any single client can talk to a
// credential endpoint, while verificationThrottle caps how many times a given
// account can be guessed at regardless of where the requests come from.

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_REQUESTS = 20;

function readPositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

// Express puts the socket address on req.ip, but tests and some proxy setups
// leave it undefined, so fall back through the usual candidates.
function defaultKeyGenerator(req) {
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

/**
 * In-memory store of request timestamps per key.
 *
 * Entries are pruned lazily on read, plus on an interval so an idle process
 * does not hold on to keys forever. The interval is unref'd so it never keeps
 * the event loop (or a test run) alive.
 */
function createMemoryStore({ windowMs, now = Date.now, sweepMs = 60 * 1000 } = {}) {
  const hits = new Map();

  function prune(key, currentTime) {
    const timestamps = hits.get(key);
    if (!timestamps) return [];

    const cutoff = currentTime - windowMs;
    const fresh = timestamps.filter((timestamp) => timestamp > cutoff);

    if (fresh.length === 0) {
      hits.delete(key);
    } else {
      hits.set(key, fresh);
    }

    return fresh;
  }

  const sweeper = setInterval(() => {
    const currentTime = now();
    for (const key of Array.from(hits.keys())) {
      prune(key, currentTime);
    }
  }, sweepMs);

  if (typeof sweeper.unref === "function") {
    sweeper.unref();
  }

  return {
    /** Records a hit and returns the number of hits inside the window. */
    record(key) {
      const currentTime = now();
      const fresh = prune(key, currentTime);

      fresh.push(currentTime);
      hits.set(key, fresh);

      return fresh.length;
    },
    /** Milliseconds until the oldest hit in the window expires. */
    retryAfterMs(key) {
      const timestamps = hits.get(key) || [];
      if (timestamps.length === 0) return 0;

      const oldest = Math.min(...timestamps);
      return Math.max(0, oldest + windowMs - now());
    },
    clear(key) {
      if (key === undefined) {
        hits.clear();
      } else {
        hits.delete(key);
      }
    },
    size() {
      return hits.size;
    },
    stop() {
      clearInterval(sweeper);
    },
  };
}

/**
 * Builds a rate limiting middleware.
 *
 * @param {object} options
 * @param {number} [options.windowMs] length of the sliding window
 * @param {number} [options.max] requests allowed per key per window
 * @param {string} [options.scope] prefix so separate limiters do not share keys
 * @param {(req: object) => string} [options.keyGenerator]
 * @param {() => number} [options.now] injectable clock, for tests
 * @param {string} [options.message] body message returned on a 429
 */
function createRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  max = DEFAULT_MAX_REQUESTS,
  scope = "global",
  keyGenerator = defaultKeyGenerator,
  now = Date.now,
  store,
  message = "Too many requests. Please try again later.",
} = {}) {
  const activeStore = store || createMemoryStore({ windowMs, now });

  function limiter(req, res, next) {
    const key = `${scope}:${keyGenerator(req)}`;
    const hitCount = activeStore.record(key);
    const remaining = Math.max(0, max - hitCount);

    res.set?.("X-RateLimit-Limit", String(max));
    res.set?.("X-RateLimit-Remaining", String(remaining));

    if (hitCount <= max) {
      return next();
    }

    const retryAfterSeconds = Math.ceil(activeStore.retryAfterMs(key) / 1000);

    res.set?.("Retry-After", String(Math.max(1, retryAfterSeconds)));

    return res.status(429).send({
      success: false,
      message,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    });
  }

  limiter.store = activeStore;

  return limiter;
}

/**
 * Reads limiter settings from the environment with safe defaults, so operators
 * can tune the limits without a code change.
 */
function rateLimitSettingsFromEnv(env = process.env) {
  return {
    windowMs:
      readPositiveInteger(env.AUTH_RATE_LIMIT_WINDOW_MINUTES, 15) * 60 * 1000,
    max: readPositiveInteger(env.AUTH_RATE_LIMIT_MAX_REQUESTS, 20),
  };
}

module.exports = {
  DEFAULT_MAX_REQUESTS,
  DEFAULT_WINDOW_MS,
  createMemoryStore,
  createRateLimiter,
  defaultKeyGenerator,
  rateLimitSettingsFromEnv,
  readPositiveInteger,
};
