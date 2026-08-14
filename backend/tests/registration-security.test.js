const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SELF_ASSIGNABLE_ROLES,
  formatValidationMessage,
  validateRegistration,
} = require("../utils/registrationValidation");

const {
  buildPaymentSummary,
  isFreeCourse,
  isValidExpiry,
  lastFourDigits,
} = require("../utils/paymentDetails");

// registerController built the user document from { ...req.body }, so the
// client controlled `type`, which is the field roleMiddleware authorises on.
// Posting "type":"admin" was a self-service privilege grant.

test("a request cannot register itself as an admin", () => {
  const result = validateRegistration({
    name: "Escalation",
    email: "escalate@example.com",
    password: "password123",
    type: "admin",
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.type);
  assert.equal(result.value, undefined);
});

test("role checks are case insensitive so ADMIN is rejected too", () => {
  for (const attempt of ["ADMIN", "Admin", " admin ", "aDmIn"]) {
    const result = validateRegistration({
      name: "Escalation",
      email: "escalate@example.com",
      password: "password123",
      type: attempt,
    });

    assert.equal(result.valid, false, `${attempt} should be rejected`);
  }
});

test("an unknown role is rejected", () => {
  const result = validateRegistration({
    name: "Unknown",
    email: "unknown@example.com",
    password: "password123",
    type: "superuser",
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.type);
});

test("student and teacher are accepted", () => {
  for (const role of SELF_ASSIGNABLE_ROLES) {
    const result = validateRegistration({
      name: "Valid User",
      email: "valid@example.com",
      password: "password123",
      type: role,
    });

    assert.equal(result.valid, true, `${role} should be accepted`);
    assert.equal(result.value.type, role);
  }
});

test("only the allow-listed fields survive validation", () => {
  const result = validateRegistration({
    name: "Sneaky",
    email: "sneaky@example.com",
    password: "password123",
    type: "student",
    isVerified: true,
    otp: "000000",
    otpExpiry: new Date(),
    resetToken: "999999",
    _id: "64b7f1c2a1b2c3d4e5f60718",
    createdAt: new Date(0),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(Object.keys(result.value).sort(), [
    "email",
    "name",
    "password",
    "type",
  ]);
});

test("a missing payload returns field errors rather than throwing", () => {
  const result = validateRegistration({});

  assert.equal(result.valid, false);
  assert.ok(result.errors.name);
  assert.ok(result.errors.email);
  assert.ok(result.errors.password);
  assert.ok(result.errors.type);
});

test("a non-string name is rejected instead of crashing the setter", () => {
  // userModel has a setter that calls value.charAt(0). A non-string used to
  // reach it and surface as an opaque 500.
  const result = validateRegistration({
    name: { first: "Object" },
    email: "object@example.com",
    password: "password123",
    type: "student",
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.name);
});

test("an invalid email shape is rejected", () => {
  for (const email of ["not-an-email", "missing@tld", "@example.com", "a b@c.com"]) {
    const result = validateRegistration({
      name: "Email Test",
      email,
      password: "password123",
      type: "student",
    });

    assert.equal(result.valid, false, `${email} should be rejected`);
  }
});

test("email is normalised to lowercase and trimmed", () => {
  const result = validateRegistration({
    name: "Case Test",
    email: "  MixedCase@Example.COM  ",
    password: "password123",
    type: "student",
  });

  assert.equal(result.valid, true);
  assert.equal(result.value.email, "mixedcase@example.com");
});

test("a short password is rejected, matching the reset password rule", () => {
  const result = validateRegistration({
    name: "Short",
    email: "short@example.com",
    password: "12345",
    type: "student",
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.password);
});

test("validation messages join into a readable sentence", () => {
  const { errors } = validateRegistration({});
  const message = formatValidationMessage(errors);

  assert.equal(typeof message, "string");
  assert.ok(message.includes("Name is required"));
});

// Payment summary

test("the payment summary never carries the CVV or the full card number", () => {
  const result = buildPaymentSummary({
    cardholdername: "Test Holder",
    cardnumber: "4242424242424242",
    cvvcode: "123",
    expmonthyear: "12/34",
  });

  assert.equal(result.valid, true);
  assert.deepEqual(Object.keys(result.value).sort(), [
    "cardLast4",
    "cardholdername",
    "expmonthyear",
  ]);

  const serialised = JSON.stringify(result.value);
  assert.ok(!serialised.includes("123"), "the CVV leaked into the summary");
  assert.ok(
    !serialised.includes("4242424242424242"),
    "the full card number leaked into the summary",
  );
  assert.equal(result.value.cardLast4, "4242");
});

test("undeclared extras posted alongside the card are dropped", () => {
  const result = buildPaymentSummary({
    cardholdername: "Test Holder",
    cardnumber: "4242424242424242",
    cvvcode: "123",
    expmonthyear: "12/34",
    status: "successful",
    amount: "0",
    userId: "64b7f1c2a1b2c3d4e5f60718",
  });

  assert.equal(result.valid, true);
  assert.equal(result.value.status, undefined);
  assert.equal(result.value.amount, undefined);
  assert.equal(result.value.userId, undefined);
});

test("last four digits are only extracted from a plausible card length", () => {
  assert.equal(lastFourDigits("4242 4242 4242 4242"), "4242");
  assert.equal(lastFourDigits("4242-4242-4242-4242"), "4242");
  assert.equal(lastFourDigits("123"), null);
  assert.equal(lastFourDigits(""), null);
  assert.equal(lastFourDigits(undefined), null);
});

test("an expired or malformed card expiry is rejected", () => {
  const now = new Date("2026-08-13T00:00:00Z");

  assert.equal(isValidExpiry("12/34", now), true);
  assert.equal(isValidExpiry("08/2026", now), true);
  assert.equal(isValidExpiry("07/26", now), false);
  assert.equal(isValidExpiry("13/30", now), false);
  assert.equal(isValidExpiry("not-a-date", now), false);
  assert.equal(isValidExpiry("", now), false);
});

test("an incomplete card is rejected with per-field errors", () => {
  const result = buildPaymentSummary({});

  assert.equal(result.valid, false);
  assert.ok(result.errors.cardholdername);
  assert.ok(result.errors.cardnumber);
  assert.ok(result.errors.expmonthyear);
  assert.ok(result.errors.cvvcode);
});

test("free courses are recognised in every shape the schema produces", () => {
  assert.equal(isFreeCourse("free"), true);
  assert.equal(isFreeCourse("Free"), true);
  assert.equal(isFreeCourse("0"), true);
  assert.equal(isFreeCourse(""), true);
  assert.equal(isFreeCourse(undefined), true);
  assert.equal(isFreeCourse("499"), false);
  assert.equal(isFreeCourse("1200"), false);
});
