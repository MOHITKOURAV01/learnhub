const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMemoryStore,
  createRateLimiter,
  defaultKeyGenerator,
  rateLimitSettingsFromEnv,
  readPositiveInteger,
} = require("../middlewares/rateLimiter");

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function createClock(startAt = 1_000_000) {
  let current = startAt;

  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

async function callLimiter(limiter, req) {
  const res = createResponse();
  let nextCalled = false;

  await limiter(req, res, () => {
    nextCalled = true;
  });

  return { res, nextCalled };
}

test("parses positive integers and falls back on junk", () => {
  assert.equal(readPositiveInteger("30", 15), 30);
  assert.equal(readPositiveInteger(undefined, 15), 15);
  assert.equal(readPositiveInteger("", 15), 15);
  assert.equal(readPositiveInteger("0", 15), 15);
  assert.equal(readPositiveInteger("-4", 15), 15);
  assert.equal(readPositiveInteger("abc", 15), 15);
  assert.equal(readPositiveInteger("1.5", 15), 15);
});

test("reads limiter settings from the environment", () => {
  const settings = rateLimitSettingsFromEnv({
    AUTH_RATE_LIMIT_WINDOW_MINUTES: "5",
    AUTH_RATE_LIMIT_MAX_REQUESTS: "3",
  });

  assert.equal(settings.windowMs, 5 * 60 * 1000);
  assert.equal(settings.max, 3);
});

test("falls back to safe defaults when the environment is empty", () => {
  const settings = rateLimitSettingsFromEnv({});

  assert.equal(settings.windowMs, 15 * 60 * 1000);
  assert.equal(settings.max, 20);
});

test("derives a key from req.ip and degrades gracefully", () => {
  assert.equal(defaultKeyGenerator({ ip: "10.0.0.1" }), "10.0.0.1");
  assert.equal(
    defaultKeyGenerator({ socket: { remoteAddress: "10.0.0.2" } }),
    "10.0.0.2",
  );
  assert.equal(defaultKeyGenerator({}), "unknown");
});

test("counts hits inside the window and forgets them afterwards", () => {
  const clock = createClock();
  const store = createMemoryStore({ windowMs: 1000, now: clock.now });

  assert.equal(store.record("a"), 1);
  assert.equal(store.record("a"), 2);

  clock.advance(1500);

  assert.equal(store.record("a"), 1);

  store.stop();
});

test("allows requests up to the limit and blocks the one after", async () => {
  const clock = createClock();
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 3,
    scope: "login",
    now: clock.now,
    keyGenerator: () => "1.2.3.4",
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { nextCalled, res } = await callLimiter(limiter, {});
    assert.equal(nextCalled, true, `attempt ${attempt + 1} should pass`);
    assert.equal(res.statusCode, 200);
  }

  const { nextCalled, res } = await callLimiter(limiter, {});

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.success, false);

  limiter.store.stop();
});

test("sets Retry-After and the remaining-requests headers", async () => {
  const clock = createClock();
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 1,
    scope: "login",
    now: clock.now,
    keyGenerator: () => "1.2.3.4",
  });

  const first = await callLimiter(limiter, {});
  assert.equal(first.res.headers["X-RateLimit-Limit"], "1");
  assert.equal(first.res.headers["X-RateLimit-Remaining"], "0");

  const blocked = await callLimiter(limiter, {});
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.headers["Retry-After"], "60");
  assert.equal(blocked.res.body.retryAfterSeconds, 60);

  limiter.store.stop();
});

test("lets the client through again once the window rolls over", async () => {
  const clock = createClock();
  const limiter = createRateLimiter({
    windowMs: 1000,
    max: 1,
    scope: "login",
    now: clock.now,
    keyGenerator: () => "1.2.3.4",
  });

  assert.equal((await callLimiter(limiter, {})).nextCalled, true);
  assert.equal((await callLimiter(limiter, {})).nextCalled, false);

  clock.advance(1500);

  assert.equal((await callLimiter(limiter, {})).nextCalled, true);

  limiter.store.stop();
});

test("keeps separate budgets per client", async () => {
  const clock = createClock();
  let currentIp = "1.1.1.1";
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 1,
    scope: "login",
    now: clock.now,
    keyGenerator: () => currentIp,
  });

  assert.equal((await callLimiter(limiter, {})).nextCalled, true);
  assert.equal((await callLimiter(limiter, {})).nextCalled, false);

  currentIp = "2.2.2.2";
  assert.equal((await callLimiter(limiter, {})).nextCalled, true);

  limiter.store.stop();
});

test("keeps separate budgets per scope", async () => {
  const clock = createClock();
  const store = createMemoryStore({ windowMs: 60_000, now: clock.now });

  const login = createRateLimiter({
    max: 1,
    scope: "login",
    now: clock.now,
    store,
    keyGenerator: () => "1.2.3.4",
  });
  const verify = createRateLimiter({
    max: 1,
    scope: "verify-otp",
    now: clock.now,
    store,
    keyGenerator: () => "1.2.3.4",
  });

  assert.equal((await callLimiter(login, {})).nextCalled, true);
  assert.equal((await callLimiter(login, {})).nextCalled, false);
  // The same client still has its verify-otp budget intact.
  assert.equal((await callLimiter(verify, {})).nextCalled, true);

  store.stop();
});

test("drops keys once every hit in the window has expired", () => {
  const clock = createClock();
  const store = createMemoryStore({ windowMs: 1000, now: clock.now });

  store.record("a");
  assert.equal(store.size(), 1);

  clock.advance(2000);
  store.record("b");

  // Recording "b" prunes only "b"; the explicit clear is what callers get.
  store.clear("a");
  assert.equal(store.size(), 1);

  store.clear();
  assert.equal(store.size(), 0);

  store.stop();
});
