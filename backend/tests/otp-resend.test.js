const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RESEND_COOLDOWN_MS,
  buildVerificationEmail,
  canResend,
  generateOtp,
  isOtpExpired,
  otpExpiryFrom,
  secondsUntilResend,
} = require("../utils/otpCodes");

const {
  NEUTRAL_RESPONSE,
  createResendOtpController,
  issueVerificationOtp,
} = require("../controllers/emailVerificationController");

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
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

/**
 * A stand-in for a Mongoose user document: the fields the flow touches plus a
 * save() that records that it was called.
 */
function createUser(overrides = {}) {
  return {
    email: "pending@example.com",
    isVerified: false,
    otp: undefined,
    otpExpiry: undefined,
    otpLastSentAt: undefined,
    saved: 0,
    async save() {
      this.saved += 1;
    },
    ...overrides,
  };
}

function createUserModel(user) {
  return {
    findOne() {
      return {
        select: async () => user,
      };
    },
  };
}

function createMailer() {
  const sent = [];

  const sendMail = async (message) => {
    sent.push(message);
    return { success: true };
  };

  return { sendMail, sent };
}

// -- code generation ---------------------------------------------------------

test("the code is always six digits and never starts with a zero", () => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const otp = generateOtp();

    assert.match(otp, /^[1-9]\d{5}$/);
  }
});

test("consecutive codes differ", () => {
  // Not a randomness test, just a guard against a constant sneaking in.
  const codes = new Set(Array.from({ length: 50 }, () => generateOtp()));

  assert.ok(codes.size > 40, `only ${codes.size} distinct codes in 50 draws`);
});

test("a code issued now expires ten minutes from now", () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0);

  assert.equal(otpExpiryFrom(now).getTime(), now + 10 * 60 * 1000);
  assert.equal(isOtpExpired(otpExpiryFrom(now), now), false);
  assert.equal(isOtpExpired(otpExpiryFrom(now), now + 10 * 60 * 1000), true);
});

test("a missing or unparseable expiry counts as expired", () => {
  assert.equal(isOtpExpired(undefined), true);
  assert.equal(isOtpExpired(null), true);
  assert.equal(isOtpExpired("not a date"), true);
});

// -- cooldown ----------------------------------------------------------------

test("a resend is allowed when nothing has been sent yet", () => {
  assert.equal(secondsUntilResend(undefined, 1000), 0);
  assert.equal(canResend(undefined, 1000), true);
});

test("a resend is blocked for a minute after the last send", () => {
  const sentAt = Date.UTC(2026, 7, 16, 12, 0, 0);

  assert.equal(secondsUntilResend(new Date(sentAt), sentAt), 60);
  assert.equal(secondsUntilResend(new Date(sentAt), sentAt + 30_000), 30);
  assert.equal(secondsUntilResend(new Date(sentAt), sentAt + 59_500), 1);
  assert.equal(secondsUntilResend(new Date(sentAt), sentAt + RESEND_COOLDOWN_MS), 0);
  assert.equal(canResend(new Date(sentAt), sentAt + RESEND_COOLDOWN_MS), true);
});

test("a timestamp in the future does not lock the address out indefinitely", () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0);
  const future = new Date(now + 24 * 60 * 60 * 1000);

  // Clock skew between app servers should cost at most one cooldown, not a day.
  assert.equal(secondsUntilResend(future, now), 60);
});

// -- issuing -----------------------------------------------------------------

test("issuing writes the code, the expiry and the send time, then mails it", async () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0);
  const user = createUser();
  const { sendMail, sent } = createMailer();

  const result = await issueVerificationOtp({ user, sendMail, nowMs: now });

  assert.equal(result.sent, true);
  assert.equal(user.saved, 1);
  assert.match(user.otp, /^\d{6}$/);
  assert.equal(user.otpExpiry.getTime(), now + 10 * 60 * 1000);
  assert.equal(user.otpLastSentAt.getTime(), now);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "pending@example.com");
  assert.ok(sent[0].text.includes(user.otp));
});

test("issuing inside the cooldown neither writes nor mails", async () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0);
  const user = createUser({ otpLastSentAt: new Date(now - 10_000) });
  const { sendMail, sent } = createMailer();

  const result = await issueVerificationOtp({ user, sendMail, nowMs: now });

  assert.equal(result.sent, false);
  assert.equal(result.retryAfterSeconds, 50);
  assert.equal(user.saved, 0);
  assert.equal(user.otp, undefined);
  assert.equal(sent.length, 0);
});

test("the mail names the ten minute lifetime the expiry actually uses", () => {
  const message = buildVerificationEmail("123456");

  assert.match(message.text, /10 minutes/);
  assert.match(message.html, /123456/);
});

// -- the resend route --------------------------------------------------------

test("a resend for an unverified account sends a new code", async () => {
  const user = createUser();
  const { sendMail, sent } = createMailer();

  const controller = createResendOtpController({
    UserModel: createUserModel(user),
    sendMail,
    now: () => Date.UTC(2026, 7, 16, 12, 0, 0),
  });

  const res = createResponse();
  await controller({ body: { email: "Pending@Example.com" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(sent.length, 1);
});

test("an unknown address and a verified account answer identically, and send nothing", async () => {
  const { sendMail, sent } = createMailer();

  const unknown = createResendOtpController({
    UserModel: createUserModel(null),
    sendMail,
  });
  const verified = createResendOtpController({
    UserModel: createUserModel(createUser({ isVerified: true })),
    sendMail,
  });

  const unknownRes = createResponse();
  const verifiedRes = createResponse();

  await unknown({ body: { email: "nobody@example.com" } }, unknownRes);
  await verified({ body: { email: "done@example.com" } }, verifiedRes);

  // Anything that distinguishes these two is an account-enumeration oracle.
  assert.equal(unknownRes.statusCode, verifiedRes.statusCode);
  assert.deepEqual(unknownRes.body, verifiedRes.body);
  assert.equal(unknownRes.body.message, NEUTRAL_RESPONSE);
  assert.equal(sent.length, 0);
});

test("a second resend inside the cooldown is refused with a wait time", async () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0);
  const user = createUser();
  const { sendMail, sent } = createMailer();

  let clock = now;
  const controller = createResendOtpController({
    UserModel: createUserModel(user),
    sendMail,
    now: () => clock,
  });

  const first = createResponse();
  await controller({ body: { email: "pending@example.com" } }, first);
  assert.equal(first.statusCode, 200);

  clock = now + 15_000;

  const second = createResponse();
  await controller({ body: { email: "pending@example.com" } }, second);

  assert.equal(second.statusCode, 429);
  assert.equal(second.body.retryAfterSeconds, 45);
  assert.equal(sent.length, 1, "the second request must not send a mail");

  clock = now + RESEND_COOLDOWN_MS;

  const third = createResponse();
  await controller({ body: { email: "pending@example.com" } }, third);

  assert.equal(third.statusCode, 200);
  assert.equal(sent.length, 2);
});

test("a missing address is a 400, not a lookup", async () => {
  let queried = false;

  const controller = createResendOtpController({
    UserModel: {
      findOne() {
        queried = true;
        return { select: async () => null };
      },
    },
  });

  const res = createResponse();
  await controller({ body: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(queried, false);
});

test("a database failure is a 500 and does not leak the error", async () => {
  const controller = createResendOtpController({
    UserModel: {
      findOne() {
        return {
          select: async () => {
            throw new Error("connection reset by peer");
          },
        };
      },
    },
    logger: { error() {} },
  });

  const res = createResponse();
  await controller({ body: { email: "pending@example.com" } }, res);

  assert.equal(res.statusCode, 500);
  assert.ok(!String(res.body.message).includes("connection reset"));
});
