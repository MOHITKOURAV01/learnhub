const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

const {
  buildCorsOptions,
  isOriginAllowed,
  normalizeOrigin,
  parseAllowedOrigins,
} = require("../config/cors");
const {
  BASE_HEADERS,
  createSecurityHeaders,
  isSecureRequest,
  securityHeaderSettingsFromEnv,
} = require("../middlewares/securityHeaders");
const { createNotFoundHandler } = require("../middlewares/notFoundHandler");
const {
  classifyError,
  createErrorHandler,
} = require("../middlewares/errorHandler");
const { createHealthRouter } = require("../routers/healthRoutes");

const silentLogger = { error() {}, warn() {}, info() {} };

// A miniature app that mounts only the middleware under test, so these suites
// do not pull in the routers (and therefore the database models).
function createTestApp({ routes = () => {}, bodyLimit = "1mb" } = {}) {
  const app = express();

  app.use(createSecurityHeaders({ enableHsts: false }));
  app.use(express.json({ limit: bodyLimit }));

  routes(app);

  app.use(createNotFoundHandler());
  app.use(createErrorHandler({ logger: silentLogger }));

  return app;
}

test("parses the FRONTEND_URL allowlist", () => {
  assert.deepEqual(
    parseAllowedOrigins("http://a.test, http://b.test"),
    ["http://a.test", "http://b.test"],
  );
});

test("strips trailing slashes from configured origins", () => {
  assert.deepEqual(parseAllowedOrigins("http://a.test/"), ["http://a.test"]);
  assert.equal(normalizeOrigin("http://a.test//"), "http://a.test");
});

test("falls back to the local dev origins when FRONTEND_URL is unset", () => {
  assert.deepEqual(parseAllowedOrigins(undefined), [
    "http://localhost:5173",
    "http://localhost:5174",
  ]);
  assert.deepEqual(parseAllowedOrigins("   "), [
    "http://localhost:5173",
    "http://localhost:5174",
  ]);
});

test("allows configured origins and rejects everything else", () => {
  const allowed = ["http://a.test"];

  assert.equal(isOriginAllowed("http://a.test", allowed), true);
  assert.equal(isOriginAllowed("http://a.test/", allowed), true);
  assert.equal(isOriginAllowed("https://evil.example", allowed), false);
});

test("allows requests that carry no Origin header at all", () => {
  // curl, server-to-server calls and health checks send no Origin, and CORS
  // has nothing to say about them.
  assert.equal(isOriginAllowed(undefined, ["http://a.test"]), true);
  assert.equal(isOriginAllowed("", ["http://a.test"]), true);
});

test("builds cors options that answer the origin callback", async () => {
  const options = buildCorsOptions({ FRONTEND_URL: "http://a.test" });

  const decide = (origin) =>
    new Promise((resolve) => options.origin(origin, (_err, allow) => resolve(allow)));

  assert.equal(await decide("http://a.test"), true);
  assert.equal(await decide("https://evil.example"), false);
  assert.equal(options.credentials, true);
  assert.deepEqual(options.allowedHeaders, ["Content-Type", "Authorization"]);
});

test("sets the baseline security headers on every response", async () => {
  const app = createTestApp({
    routes: (instance) => instance.get("/api/ping", (req, res) => res.json({ ok: true })),
  });

  const response = await request(app).get("/api/ping");

  for (const [header, value] of Object.entries(BASE_HEADERS)) {
    assert.equal(response.headers[header.toLowerCase()], value);
  }
});

test("omits HSTS on a plain HTTP request", async () => {
  const app = express();
  app.use(createSecurityHeaders({ enableHsts: true }));
  app.get("/api/ping", (req, res) => res.json({ ok: true }));

  const response = await request(app).get("/api/ping");

  assert.equal(response.headers["strict-transport-security"], undefined);
});

test("sends HSTS when the proxy reports HTTPS", async () => {
  const app = express();
  app.use(createSecurityHeaders({ enableHsts: true }));
  app.get("/api/ping", (req, res) => res.json({ ok: true }));

  const response = await request(app)
    .get("/api/ping")
    .set("X-Forwarded-Proto", "https");

  assert.match(
    response.headers["strict-transport-security"],
    /max-age=31536000/,
  );
});

test("detects a secure request from either source", () => {
  assert.equal(isSecureRequest({ secure: true, headers: {} }), true);
  assert.equal(
    isSecureRequest({ headers: { "x-forwarded-proto": "https,http" } }),
    true,
  );
  assert.equal(isSecureRequest({ headers: { "x-forwarded-proto": "http" } }), false);
  assert.equal(isSecureRequest({ headers: {} }), false);
});

test("enables HSTS in production and honours the explicit override", () => {
  assert.deepEqual(securityHeaderSettingsFromEnv({ NODE_ENV: "production" }), {
    enableHsts: true,
  });
  assert.deepEqual(securityHeaderSettingsFromEnv({ NODE_ENV: "development" }), {
    enableHsts: false,
  });
  assert.deepEqual(
    securityHeaderSettingsFromEnv({ NODE_ENV: "production", ENABLE_HSTS: "false" }),
    { enableHsts: false },
  );
});

test("answers an unknown API route with JSON, not HTML", async () => {
  const app = createTestApp();

  const response = await request(app).get("/api/user/typo");

  assert.equal(response.status, 404);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.equal(response.body.success, false);
  assert.match(response.body.message, /Route not found: GET \/api\/user\/typo/);
});

test("leaves non-API paths to the default handler", async () => {
  const app = createTestApp();

  const response = await request(app).get("/uploads/missing.mp4");

  assert.equal(response.status, 404);
  // Not our JSON envelope — Express's own handler answered.
  assert.equal(response.body.success, undefined);
});

test("turns malformed JSON into a 400 instead of a 500", async () => {
  const app = createTestApp({
    routes: (instance) =>
      instance.post("/api/user/login", (req, res) => res.json({ success: true })),
  });

  const response = await request(app)
    .post("/api/user/login")
    .set("Content-Type", "application/json")
    .send("{");

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, "Malformed JSON body");
});

test("turns an oversized body into a 413", async () => {
  const app = createTestApp({
    bodyLimit: "1kb",
    routes: (instance) =>
      instance.post("/api/echo", (req, res) => res.json({ success: true })),
  });

  const response = await request(app)
    .post("/api/echo")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ padding: "x".repeat(4096) }));

  assert.equal(response.status, 413);
  assert.equal(response.body.message, "Request body is too large");
});

test("maps a Mongoose CastError to a 400", () => {
  const error = new Error("Cast to ObjectId failed");
  error.name = "CastError";
  error.path = "courseId";

  assert.deepEqual(classifyError(error), {
    status: 400,
    message: "Invalid value for courseId",
    expected: true,
  });
});

test("maps a Mongoose ValidationError to a 400 with its details", () => {
  const error = new Error("validation failed");
  error.name = "ValidationError";
  error.errors = {
    C_title: { message: "C_title is required" },
    C_price: { message: "C_price must be a number" },
  };

  const classified = classifyError(error);

  assert.equal(classified.status, 400);
  assert.equal(classified.message, "C_title is required, C_price must be a number");
});

test("keeps the existing Multer behaviour", () => {
  const error = new Error("File too large");
  error.name = "MulterError";

  assert.deepEqual(classifyError(error), {
    status: 400,
    message: "File too large",
    expected: true,
  });
});

test("hides the details of an unrecognised failure", () => {
  const classified = classifyError(new Error("MongoServerError: auth failed on db"));

  assert.equal(classified.status, 500);
  assert.equal(classified.message, "Internal server error");
  assert.equal(classified.expected, false);
});

test("logs an unexpected failure with method, path and stack", async () => {
  const logged = [];
  const app = express();
  app.get("/api/boom", () => {
    throw new Error("kaboom");
  });
  app.use(
    createErrorHandler({
      logger: {
        warn() {},
        error(message, context) {
          logged.push({ message, context });
        },
      },
    }),
  );

  const response = await request(app).get("/api/boom");

  assert.equal(response.status, 500);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].context.method, "GET");
  assert.equal(logged[0].context.path, "/api/boom");
  assert.equal(logged[0].context.error, "kaboom");
  assert.match(logged[0].context.stack, /kaboom/);
});

test("logs a client mistake at warn level, not error", async () => {
  const warnings = [];
  const errors = [];
  const app = express();
  app.get("/api/bad", (req, res, next) => {
    const error = new Error("Cast to ObjectId failed");
    error.name = "CastError";
    error.path = "id";
    next(error);
  });
  app.use(
    createErrorHandler({
      logger: {
        warn(message, context) {
          warnings.push(context);
        },
        error(message, context) {
          errors.push(context);
        },
      },
    }),
  );

  await request(app).get("/api/bad");

  assert.equal(warnings.length, 1);
  assert.equal(errors.length, 0);
});

test("reports a healthy service when the database is connected", async () => {
  const app = express();
  app.use("/api/health", createHealthRouter({
    connection: { readyState: 1 },
    uptime: () => 42.9,
  }));

  const response = await request(app).get("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    status: "ok",
    uptimeSeconds: 42,
    database: "connected",
  });
});

test("reports 503 when the database connection is down", async () => {
  const app = express();
  app.use("/api/health", createHealthRouter({
    connection: { readyState: 0 },
    uptime: () => 1,
  }));

  const response = await request(app).get("/api/health");

  assert.equal(response.status, 503);
  assert.equal(response.body.status, "degraded");
  assert.equal(response.body.database, "disconnected");
});
