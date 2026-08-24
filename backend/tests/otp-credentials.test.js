const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

const {
  CODE_LENGTH,
  MAX_ATTEMPTS,
  VERIFICATION,
  generateCode,
  isFailure,
  isWellFormedCode,
  issueCredential,
  verifyCredential,
} = require("../utils/otpCredentials");

let app;
let User;

test.before(async () => {
  await startTestDatabase();
  app = require("../app");
  User = require("../schemas/userModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

/* ------------------------------------------------------------------ *
 * utils/otpCredentials
 * ------------------------------------------------------------------ */

test("codes are the right length and drawn from a cryptographic source", () => {
  const codes = new Set();

  for (let i = 0; i < 200; i += 1) {
    const code = generateCode();

    assert.match(code, new RegExp(`^\\d{${CODE_LENGTH}}$`));
    // No leading zero: the range starts at 100000, as it always has.
    assert.notEqual(code[0], "0");
    codes.add(code);
  }

  // Not a distribution test, just a guard against a constant.
  assert.ok(codes.size > 150);
});

test("only the hash is issued for storage, and it is a real bcrypt hash", async () => {
  const credential = await issueCredential();

  assert.match(credential.hash, /^\$2[aby]\$\d{2}\$/);
  assert.notEqual(credential.hash, credential.code);
  assert.equal(await bcrypt.compare(credential.code, credential.hash), true);
  assert.equal(credential.attempts, 0);
  assert.ok(credential.expiresAt instanceof Date);
});

test("a correct code verifies once, and is marked spent", async () => {
  const credential = await issueCredential();
  const result = await verifyCredential(credential, credential.code);

  assert.equal(result.status, VERIFICATION.OK);
  assert.equal(result.shouldClear, true);
  assert.equal(isFailure(result.status), false);
});

test("a wrong code increments the attempt counter", async () => {
  const credential = await issueCredential();
  const result = await verifyCredential(
    { ...credential, attempts: 2 },
    "000000",
  );

  assert.equal(result.status, VERIFICATION.INVALID);
  assert.equal(result.attempts, 3);
  assert.equal(result.shouldClear, false);
});

test("the attempt limit destroys the credential rather than parking it", async () => {
  const credential = await issueCredential();
  const result = await verifyCredential(
    { ...credential, attempts: MAX_ATTEMPTS - 1 },
    "000000",
  );

  assert.equal(result.status, VERIFICATION.INVALID);
  assert.equal(result.attempts, MAX_ATTEMPTS);
  // A locked-but-live code is a code somebody can keep working on.
  assert.equal(result.shouldClear, true);
});

test("a credential already at the limit is refused without comparing", async () => {
  const credential = await issueCredential();
  const result = await verifyCredential(
    { ...credential, attempts: MAX_ATTEMPTS },
    // Even the correct code.
    credential.code,
  );

  assert.equal(result.status, VERIFICATION.LOCKED);
  assert.equal(result.shouldClear, true);
});

test("an expired credential is refused and cleared", async () => {
  const credential = await issueCredential();
  const result = await verifyCredential(
    { ...credential, expiresAt: new Date(Date.now() - 1000) },
    credential.code,
  );

  assert.equal(result.status, VERIFICATION.EXPIRED);
  assert.equal(result.shouldClear, true);
});

test("a missing or unusable expiry is treated as expired, not as valid", async () => {
  const credential = await issueCredential();

  for (const expiresAt of [undefined, null, "soon", NaN]) {
    const result = await verifyCredential(
      { ...credential, expiresAt },
      credential.code,
    );

    assert.equal(result.status, VERIFICATION.EXPIRED);
  }
});

test("no stored credential is MISSING, and never OK", async () => {
  assert.equal(
    (await verifyCredential(null, "123456")).status,
    VERIFICATION.MISSING,
  );
  assert.equal(
    (await verifyCredential({}, "123456")).status,
    VERIFICATION.MISSING,
  );
  assert.equal(
    (await verifyCredential({ hash: "" }, "123456")).status,
    VERIFICATION.MISSING,
  );
});

test("a malformed candidate costs an attempt and never matches", async () => {
  const credential = await issueCredential();

  for (const candidate of ["", "12345", "1234567", "abcdef", null, 123456, {}]) {
    const result = await verifyCredential(credential, candidate);

    assert.equal(result.status, VERIFICATION.INVALID);
  }
});

test("isWellFormedCode accepts only a bare six-digit string", () => {
  assert.equal(isWellFormedCode("123456"), true);
  assert.equal(isWellFormedCode(" 123456 "), true);
  assert.equal(isWellFormedCode("12345"), false);
  assert.equal(isWellFormedCode("1234567"), false);
  assert.equal(isWellFormedCode("12345a"), false);
  assert.equal(isWellFormedCode(123456), false);
  assert.equal(isWellFormedCode(null), false);
});

test("every non-OK status is a failure", () => {
  assert.equal(isFailure(VERIFICATION.OK), false);
  assert.equal(isFailure(VERIFICATION.INVALID), true);
  assert.equal(isFailure(VERIFICATION.EXPIRED), true);
  assert.equal(isFailure(VERIFICATION.LOCKED), true);
  assert.equal(isFailure(VERIFICATION.MISSING), true);
  // Fails closed for anything added later.
  assert.equal(isFailure("something-new"), true);
});

/* ------------------------------------------------------------------ *
 * What is on disk
 * ------------------------------------------------------------------ */

test("registration stores a hash, not the code that was emailed", async () => {
  const response = await request(app).post("/api/user/register").send({
    name: "Otto",
    email: "otto@example.com",
    password: "password123",
    type: "student",
  });

  assert.equal(response.status, 201);

  const user = await User.findOne({ email: "otto@example.com" }).select(
    "+otp +otpExpiry +otpAttempts",
  );

  assert.ok(user.otp);
  assert.match(user.otp, /^\$2[aby]\$\d{2}\$/);
  // The whole of #95: nothing in this collection is a usable credential.
  assert.equal(/^\d{6}$/.test(user.otp), false);
  assert.equal(user.otpAttempts, 0);
  assert.ok(user.otpExpiry instanceof Date);
});

test("a bare find() returns neither the hash nor the attempt counter", async () => {
  await request(app).post("/api/user/register").send({
    name: "Otto",
    email: "otto@example.com",
    password: "password123",
    type: "student",
  });

  const user = await User.findOne({ email: "otto@example.com" });

  assert.equal(user.otp, undefined);
  assert.equal(user.otpExpiry, undefined);
  assert.equal(user.otpAttempts, undefined);
  assert.equal(JSON.parse(JSON.stringify(user)).otp, undefined);
});

/* ------------------------------------------------------------------ *
 * POST /api/user/verify-otp
 * ------------------------------------------------------------------ */

async function registerWithKnownCode(email = "otto@example.com") {
  await request(app).post("/api/user/register").send({
    name: "Otto",
    email,
    password: "password123",
    type: "student",
  });

  // The plaintext never leaves the handler, so plant a hash of a known code.
  const code = "424242";
  await User.updateOne(
    { email },
    {
      $set: {
        otp: await bcrypt.hash(code, 10),
        otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
        otpAttempts: 0,
      },
    },
  );

  return code;
}

test("an unknown address and a wrong code are answered identically", async () => {
  await registerWithKnownCode();

  const unknown = await request(app)
    .post("/api/user/verify-otp")
    .send({ email: "nobody@example.com", otp: "000000" });

  const wrong = await request(app)
    .post("/api/user/verify-otp")
    .send({ email: "otto@example.com", otp: "000000" });

  // On main these were 404 "User not found" and 400 "Invalid or expired OTP",
  // which confirmed or denied any address in one unauthenticated request.
  assert.equal(unknown.status, 400);
  assert.equal(wrong.status, 400);
  assert.deepEqual(unknown.body, wrong.body);
});

test("the correct code verifies the account and spends the credential", async () => {
  const code = await registerWithKnownCode();

  const first = await request(app)
    .post("/api/user/verify-otp")
    .send({ email: "otto@example.com", otp: code });

  assert.equal(first.status, 200);
  assert.equal(first.body.success, true);

  const user = await User.findOne({ email: "otto@example.com" }).select(
    "+otp +otpExpiry +otpAttempts",
  );

  assert.equal(user.isVerified, true);
  assert.equal(user.otp, undefined);
  assert.equal(user.otpExpiry, undefined);
  assert.equal(user.otpAttempts, undefined);
});

test("wrong attempts accumulate and the credential dies at the limit", async () => {
  const code = await registerWithKnownCode();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await request(app)
      .post("/api/user/verify-otp")
      .send({ email: "otto@example.com", otp: "000000" });

    assert.equal(response.status, 400);
  }

  const user = await User.findOne({ email: "otto@example.com" }).select(
    "+otp +otpAttempts",
  );

  assert.equal(user.otp, undefined);

  // The correct code no longer works, because there is nothing left to match.
  const afterLimit = await request(app)
    .post("/api/user/verify-otp")
    .send({ email: "otto@example.com", otp: code });

  assert.equal(afterLimit.status, 400);
  assert.equal(afterLimit.body.success, false);
  assert.equal((await User.findOne({ email: "otto@example.com" })).isVerified, false);
});

test("an expired code is refused with the same answer as a wrong one", async () => {
  await registerWithKnownCode();
  await User.updateOne(
    { email: "otto@example.com" },
    { $set: { otpExpiry: new Date(Date.now() - 1000) } },
  );

  const response = await request(app)
    .post("/api/user/verify-otp")
    .send({ email: "otto@example.com", otp: "424242" });

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Invalid or expired OTP");
});

test("a code left on a verified account is cleared rather than left live", async () => {
  await registerWithKnownCode();
  await User.updateOne({ email: "otto@example.com" }, { $set: { isVerified: true } });

  const response = await request(app)
    .post("/api/user/verify-otp")
    .send({ email: "otto@example.com", otp: "000000" });

  assert.equal(response.status, 200);

  const user = await User.findOne({ email: "otto@example.com" }).select("+otp");

  assert.equal(user.otp, undefined);
});

/* ------------------------------------------------------------------ *
 * POST /api/user/forgot-password and /reset-password
 * ------------------------------------------------------------------ */

test("forgot-password stores a hash and resets the attempt counter", async () => {
  await registerWithKnownCode();
  await User.updateOne(
    { email: "otto@example.com" },
    { $set: { isVerified: true, resetTokenAttempts: 4 } },
  );

  const response = await request(app)
    .post("/api/user/forgot-password")
    .send({ email: "otto@example.com" });

  assert.equal(response.status, 200);

  const user = await User.findOne({ email: "otto@example.com" }).select(
    "+resetToken +resetTokenExpiry +resetTokenAttempts",
  );

  assert.match(user.resetToken, /^\$2[aby]\$\d{2}\$/);
  // A new code supersedes the old one and clears the lockout, or an account
  // that hit the limit could never recover.
  assert.equal(user.resetTokenAttempts, 0);
});

test("reset-password no longer distinguishes an unknown address", async () => {
  await registerWithKnownCode();

  const unknown = await request(app).post("/api/user/reset-password").send({
    email: "nobody@example.com",
    token: "000000",
    newPassword: "newpassword123",
  });

  const wrong = await request(app).post("/api/user/reset-password").send({
    email: "otto@example.com",
    token: "000000",
    newPassword: "newpassword123",
  });

  // 404 "User not found" on main.
  assert.equal(unknown.status, 400);
  assert.equal(wrong.status, 400);
  assert.deepEqual(unknown.body, wrong.body);
});

test("a valid reset code changes the password once and is then spent", async () => {
  await registerWithKnownCode();
  const code = "313131";
  await User.updateOne(
    { email: "otto@example.com" },
    {
      $set: {
        resetToken: await bcrypt.hash(code, 10),
        resetTokenExpiry: new Date(Date.now() + 10 * 60 * 1000),
        resetTokenAttempts: 0,
      },
    },
  );

  const first = await request(app).post("/api/user/reset-password").send({
    email: "otto@example.com",
    token: code,
    newPassword: "newpassword123",
  });

  assert.equal(first.status, 200);
  assert.equal(first.body.success, true);

  const user = await User.findOne({ email: "otto@example.com" }).select(
    "+password +resetToken +resetTokenAttempts +otp",
  );

  assert.equal(await bcrypt.compare("newpassword123", user.password), true);
  assert.equal(user.resetToken, undefined);
  assert.equal(user.resetTokenAttempts, undefined);
  // A password change ends any pending verification code too.
  assert.equal(user.otp, undefined);
  assert.equal(user.isVerified, true);

  // Replaying it does nothing.
  const replay = await request(app).post("/api/user/reset-password").send({
    email: "otto@example.com",
    token: code,
    newPassword: "evenNewer123",
  });

  assert.equal(replay.status, 400);
  assert.equal(
    await bcrypt.compare("newpassword123", (await User.findOne({ email: "otto@example.com" }).select("+password")).password),
    true,
  );
});

test("forgot-password still answers uniformly for an unknown address", async () => {
  const known = await request(app)
    .post("/api/user/forgot-password")
    .send({ email: "nobody@example.com" });

  assert.equal(known.status, 200);
  assert.equal(known.body.success, true);
  assert.match(known.body.message, /If that email exists/);
});
