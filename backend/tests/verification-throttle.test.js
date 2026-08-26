const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createVerificationThrottle,
  defaultIdentify,
  isFailureBody,
  throttleSettingsFromEnv,
} = require("../middlewares/verificationThrottle");

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

function createAttemptModel(initialRecord = null) {
  const calls = { updateOne: [], deleteOne: [], findOne: [] };
  let record = initialRecord;

  return {
    calls,
    setRecord(next) {
      record = next;
    },
    model: {
      async findOne(filter) {
        calls.findOne.push(filter);
        return record;
      },
      async updateOne(filter, update, options) {
        calls.updateOne.push({ filter, update, options });
        return { modifiedCount: 1 };
      },
      async deleteOne(filter) {
        calls.deleteOne.push(filter);
        return { deletedCount: record ? 1 : 0 };
      },
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

const silentLogger = { error() {}, warn() {} };

// Runs the middleware then simulates the controller answering with `body`.
async function run(throttle, req, body) {
  const res = createResponse();
  let nextCalled = false;

  await throttle(req, res, () => {
    nextCalled = true;
  });

  if (nextCalled && body !== undefined) {
    res.send(body);
  }

  // The counter write is fire-and-forget, so let the microtask queue drain.
  await new Promise((resolve) => setImmediate(resolve));

  return { res, nextCalled };
}

test("identifies the account by a normalised email address", () => {
  assert.equal(defaultIdentify({ body: { email: "  User@Example.COM " } }), "user@example.com");
  assert.equal(defaultIdentify({ body: {} }), null);
  assert.equal(defaultIdentify({ body: { email: "   " } }), null);
  assert.equal(defaultIdentify({}), null);
});

test("treats success:false as a failure and anything else as a pass", () => {
  assert.equal(isFailureBody({ success: false }), true);
  assert.equal(isFailureBody({ success: true }), false);
  assert.equal(isFailureBody("plain string"), false);
  assert.equal(isFailureBody(undefined), false);
});

test("reads throttle settings from the environment", () => {
  const settings = throttleSettingsFromEnv({
    AUTH_MAX_FAILED_ATTEMPTS: "3",
    AUTH_FAILED_ATTEMPT_WINDOW_MINUTES: "10",
    AUTH_LOCKOUT_MINUTES: "30",
  });

  assert.equal(settings.maxFailures, 3);
  assert.equal(settings.windowMs, 10 * 60 * 1000);
  assert.equal(settings.lockMs, 30 * 60 * 1000);

  const defaults = throttleSettingsFromEnv({});
  assert.equal(defaults.maxFailures, 5);
  assert.equal(defaults.windowMs, 15 * 60 * 1000);
  assert.equal(defaults.lockMs, 15 * 60 * 1000);
});

test("refuses to build a throttle without a scope", () => {
  assert.throws(() => createVerificationThrottle({}), /requires a scope/);
});

test("passes through when the request has no identifier", async () => {
  const attempts = createAttemptModel();
  const throttle = createVerificationThrottle({
    Attempt: attempts.model,
    scope: "verify-otp",
    logger: silentLogger,
  });

  const { nextCalled } = await run(throttle, { body: {} }, { success: false });

  assert.equal(nextCalled, true);
  assert.equal(attempts.calls.findOne.length, 0);
});

test("records a failed attempt against the targeted account", async () => {
  const clock = createClock();
  const attempts = createAttemptModel();
  const throttle = createVerificationThrottle({
    Attempt: attempts.model,
    scope: "verify-otp",
    maxFailures: 5,
    now: clock.now,
    logger: silentLogger,
  });

  await run(
    throttle,
    { body: { email: "victim@example.com", otp: "000000" } },
    { success: false, message: "Invalid or expired OTP" },
  );

  assert.equal(attempts.calls.updateOne.length, 1);
  const { filter, update, options } = attempts.calls.updateOne[0];
  assert.deepEqual(filter, { scope: "verify-otp", identifier: "victim@example.com" });
  assert.equal(update.$set.failedAttempts, 1);
  assert.equal(update.$set.lockedUntil, null);
  assert.equal(options.upsert, true);
});

test("locks the account once the failure budget is used up", async () => {
  const clock = createClock();
  const attempts = createAttemptModel({
    failedAttempts: 2,
    firstFailedAt: new Date(clock.now()),
    lockedUntil: null,
  });
  const throttle = createVerificationThrottle({
    Attempt: attempts.model,
    scope: "verify-otp",
    maxFailures: 3,
    lockMs: 15 * 60 * 1000,
    now: clock.now,
    logger: silentLogger,
  });

  await run(
    throttle,
    { body: { email: "victim@example.com" } },
    { success: false },
  );

  const { update } = attempts.calls.updateOne[0];
  assert.equal(update.$set.failedAttempts, 3);
  assert.notEqual(update.$set.lockedUntil, null);
  assert.equal(
    update.$set.lockedUntil.getTime(),
    clock.now() + 15 * 60 * 1000,
  );
});

test("rejects a locked account with 429 without reaching the controller", async () => {
  const clock = createClock();
  const attempts = createAttemptModel({
    failedAttempts: 5,
    firstFailedAt: new Date(clock.now()),
    lockedUntil: new Date(clock.now() + 120_000),
  });
  const throttle = createVerificationThrottle({
    Attempt: attempts.model,
    scope: "verify-otp",
    now: clock.now,
    logger: silentLogger,
  });

  const { res, nextCalled } = await run(throttle, {
    body: { email: "victim@example.com" },
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.success, false);
  assert.equal(res.body.retryAfterSeconds, 120);
  assert.equal(res.headers["Retry-After"], "120");
});

test("lets the account back in once the lock expires", async () => {
  const clock = createClock();
  const attempts = createAttemptModel({
    failedAttempts: 5,
    firstFailedAt: new Date(clock.now()),
    lockedUntil: new Date(clock.now() + 60_000),
  });
  const throttle = createVerificationThrottle({
    Attempt: attempts.model,
    scope: "verify-otp",
    maxFailures: 5,
    windowMs: 15 * 60 * 1000,
    now: clock.now,
    logger: silentLogger,
  });

  assert.equal((await run(throttle, { body: { email: "a@b.com" } })).nextCalled, false);

  clock.advance(61_000);

  const { nextCalled } = await run(throttle, { body: { email: "a@b.com" } });
  assert.equal(nextCalled, true);
});

test("starts a fresh count when the failure window has rolled over", async () => {
  const clock = createClock();
  const attempts = createAttemptModel({
    failedAttempts: 4,
    firstFailedAt: new Date(clock.now() - 20 * 60 * 1000),
    lockedUntil: null,
  });
  const throttle = createVerificationThrottle({
    Attempt: attempts.model,
    scope: "login",
    maxFailures: 5,
    windowMs: 15 * 60 * 1000,
    now: clock.now,
    logger: silentLogger,
  });

  await run(throttle, { body: { email: "a@b.com" } }, { success: false });

  // Yesterday's four failures must not put this user one mistake from a lock.
  assert.equal(attempts.calls.updateOne[0].update.$set.failedAttempts, 1);
});

test("clears the counter after a successful attempt", async () => {
  const clock = createClock();
  const attempts = createAttemptModel({
    failedAttempts: 3,
    firstFailedAt: new Date(clock.now()),
    lockedUntil: null,
  });
  const throttle = createVerificationThrottle({
    Attempt: attempts.model,
    scope: "login",
    now: clock.now,
    logger: silentLogger,
  });

  await run(throttle, { body: { email: "a@b.com" } }, { success: true, token: "x" });

  assert.equal(attempts.calls.deleteOne.length, 1);
  assert.equal(attempts.calls.updateOne.length, 0);
});

test("does not double count when a handler sends twice", async () => {
  const clock = createClock();
  const attempts = createAttemptModel();
  const throttle = createVerificationThrottle({
    Attempt: attempts.model,
    scope: "login",
    now: clock.now,
    logger: silentLogger,
  });

  const res = createResponse();
  await throttle({ body: { email: "a@b.com" } }, res, () => {});
  res.send({ success: false });
  res.send({ success: false });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(attempts.calls.updateOne.length, 1);
});

test("keeps the endpoint working when the counter store is unreachable", async () => {
  const throttle = createVerificationThrottle({
    Attempt: {
      async findOne() {
        throw new Error("connection refused");
      },
    },
    scope: "login",
    logger: silentLogger,
  });

  const { nextCalled, res } = await run(
    throttle,
    { body: { email: "a@b.com" } },
    { success: true },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("counts failures per scope so one endpoint cannot lock another", async () => {
  const clock = createClock();
  const attempts = createAttemptModel();
  const loginThrottle = createVerificationThrottle({
    Attempt: attempts.model,
    scope: "login",
    now: clock.now,
    logger: silentLogger,
  });
  const otpThrottle = createVerificationThrottle({
    Attempt: attempts.model,
    scope: "verify-otp",
    now: clock.now,
    logger: silentLogger,
  });

  await run(loginThrottle, { body: { email: "a@b.com" } }, { success: false });
  await run(otpThrottle, { body: { email: "a@b.com" } }, { success: false });

  assert.equal(attempts.calls.updateOne[0].filter.scope, "login");
  assert.equal(attempts.calls.updateOne[1].filter.scope, "verify-otp");
});
