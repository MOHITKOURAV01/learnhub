const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

const { buildPaymentSummary } = require("../utils/paymentDetails");

// coursePaymentModel was declared strict: false and the enrollment handler
// wrote { ...req.body } into it, so the whole posted body was persisted,
// including cvvcode. These tests pin what the collection is allowed to hold.

let CoursePayment;

test.before(async () => {
  await startTestDatabase();
  CoursePayment = require("../schemas/coursePaymentModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

const objectId = () => new mongoose.Types.ObjectId();

test("undeclared keys are dropped instead of persisted", async () => {
  const created = await CoursePayment.create({
    userId: objectId(),
    courseId: objectId(),
    cardDetails: {
      cardholdername: "Test Holder",
      cardLast4: "4242",
      expmonthyear: "12/34",
    },
    // Everything below is what the checkout form used to post straight through.
    cvvcode: "123",
    cardnumber: "4242424242424242",
    password: "not-a-payment-field",
    userAgent: "curl/8.0",
  });

  const stored = await CoursePayment.findById(created._id).lean();
  const serialised = JSON.stringify(stored);

  assert.equal(stored.cvvcode, undefined);
  assert.equal(stored.cardnumber, undefined);
  assert.equal(stored.password, undefined);
  assert.equal(stored.userAgent, undefined);

  assert.ok(!serialised.includes("4242424242424242"), "full PAN persisted");
  assert.ok(!serialised.includes("not-a-payment-field"), "extra key persisted");
});

test("the card sub-document no longer declares cvvcode or cardnumber", async () => {
  const created = await CoursePayment.create({
    userId: objectId(),
    courseId: objectId(),
    cardDetails: {
      cardholdername: "Test Holder",
      cardLast4: "4242",
      expmonthyear: "12/34",
      cvvcode: 123,
      cardnumber: 4242424242424242,
    },
  });

  const stored = await CoursePayment.findById(created._id).lean();

  assert.equal(stored.cardDetails.cvvcode, undefined);
  assert.equal(stored.cardDetails.cardnumber, undefined);
  assert.equal(stored.cardDetails.cardLast4, "4242");
  assert.equal(stored.cardDetails.cardholdername, "Test Holder");
});

test("a summary built from a checkout payload persists cleanly", async () => {
  const summary = buildPaymentSummary({
    cardholdername: "Round Trip",
    cardnumber: "5555 5555 5555 4444",
    cvvcode: "999",
    expmonthyear: "01/35",
  });

  assert.equal(summary.valid, true);

  const created = await CoursePayment.create({
    userId: objectId(),
    courseId: objectId(),
    amount: "499",
    cardDetails: summary.value,
  });

  const stored = await CoursePayment.findById(created._id).lean();

  assert.equal(stored.cardDetails.cardLast4, "4444");
  assert.equal(stored.amount, "499");
  assert.equal(stored.status, "enrolled");
  assert.ok(!JSON.stringify(stored).includes("999"), "the CVV was persisted");
});

test("a free enrollment stores no card details at all", async () => {
  const created = await CoursePayment.create({
    userId: objectId(),
    courseId: objectId(),
    amount: "free",
  });

  const stored = await CoursePayment.findById(created._id).lean();

  assert.equal(stored.amount, "free");
  assert.equal(stored.cardDetails, undefined);
});
