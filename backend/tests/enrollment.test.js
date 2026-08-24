const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  createEnrollCourseController,
  getEnrollingUserId,
  isDuplicateKeyError,
} = require("../controllers/enrollmentController");
const {
  countSections,
  hasReadableSections,
  normalizeSections,
} = require("../utils/courseSections");

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

function createRequest({ courseId, userId, body = {} } = {}) {
  return {
    params: { courseid: courseId || new mongoose.Types.ObjectId().toString() },
    user: { _id: userId || new mongoose.Types.ObjectId() },
    body,
  };
}

function duplicateKeyError() {
  const error = new Error("E11000 duplicate key error collection");
  error.name = "MongoServerError";
  error.code = 11000;
  return error;
}

// A card that passes buildPaymentSummary. The expiry is far enough out that
// the test will not start failing on a date.
const validCard = {
  cardholdername: "A Student",
  cardnumber: "4242424242424242",
  cvvcode: "123",
  expmonthyear: "12/2099",
};

function createDependencies({
  course = {
    _id: new mongoose.Types.ObjectId(),
    C_title: "Intro to Node",
    C_price: "free",
    sections: [{ S_title: "One" }, { S_title: "Two" }],
  },
  existingEnrollment = null,
  createEnrollmentError = null,
} = {}) {
  const calls = {
    enrollmentCreate: [],
    enrollmentUpdate: [],
    paymentCreate: [],
    courseUpdate: [],
  };

  return {
    calls,
    deps: {
      isValidObjectId: () => true,
      logger: { error() {}, warn() {} },
      Course: {
        async findById() {
          return course;
        },
        async updateOne(filter, update) {
          calls.courseUpdate.push({ filter, update });
          return { modifiedCount: 1 };
        },
      },
      EnrolledCourse: {
        async findOne() {
          return existingEnrollment;
        },
        async create(document) {
          calls.enrollmentCreate.push(document);
          if (createEnrollmentError) throw createEnrollmentError;
          return document;
        },
        async updateOne(filter, update) {
          calls.enrollmentUpdate.push({ filter, update });
          return { modifiedCount: 1 };
        },
      },
      CoursePayment: {
        async create(document) {
          calls.paymentCreate.push(document);
          return document;
        },
      },
    },
  };
}

test("counts sections stored as an array", () => {
  assert.equal(countSections([{ S_title: "a" }, { S_title: "b" }]), 2);
});

test("counts sections stored as an object map", () => {
  assert.equal(countSections({ 0: { S_title: "a" }, 1: { S_title: "b" } }), 2);
});

test("counts missing sections as zero instead of throwing", () => {
  assert.equal(countSections(undefined), 0);
  assert.equal(countSections(null), 0);
  assert.equal(countSections({}), 0);
});

test("normalizes an object map into an ordered array", () => {
  const sections = normalizeSections({ 0: { S_title: "a" }, 1: { S_title: "b" } });

  assert.equal(Array.isArray(sections), true);
  assert.deepEqual(sections, [{ S_title: "a" }, { S_title: "b" }]);
});

test("flags a corrupt sections field as unreadable", () => {
  assert.equal(hasReadableSections([]), true);
  assert.equal(hasReadableSections({}), true);
  assert.equal(hasReadableSections(undefined), true);
  assert.equal(hasReadableSections("two sections"), false);
  assert.equal(hasReadableSections(7), false);
});

test("reads the enrolling user from the auth middleware, not the body", () => {
  const authenticatedId = new mongoose.Types.ObjectId();
  const spoofedId = new mongoose.Types.ObjectId().toString();

  const userId = getEnrollingUserId({
    user: { _id: authenticatedId },
    body: { userId: spoofedId },
  });

  assert.equal(userId, authenticatedId.toString());
  assert.notEqual(userId, spoofedId);
});

test("recognises a Mongo duplicate key error", () => {
  assert.equal(isDuplicateKeyError(duplicateKeyError()), true);
  assert.equal(isDuplicateKeyError(new Error("something else")), false);
  assert.equal(isDuplicateKeyError(null), false);
});

test("rejects an unauthenticated request with 401", async () => {
  const { deps } = createDependencies();
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller({ params: { courseid: "abc" }, body: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("rejects a malformed course id with 400 rather than a 500 CastError", async () => {
  const { deps } = createDependencies();
  const controller = createEnrollCourseController({
    ...deps,
    isValidObjectId: () => false,
  });
  const res = createResponse();

  await controller(createRequest({ courseId: "not-an-id" }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid course ID");
});

test("returns 404 when the course does not exist", async () => {
  const { deps } = createDependencies({ course: null });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
});

test("enrols successfully when sections is an object map", async () => {
  const { calls, deps } = createDependencies({
    course: {
      _id: new mongoose.Types.ObjectId(),
      C_title: "Object sections",
      sections: { 0: { S_title: "a" }, 1: { S_title: "b" }, 2: { S_title: "c" } },
    },
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.alreadyEnrolled, false);
  assert.equal(calls.enrollmentCreate.length, 1);
  assert.equal(calls.enrollmentCreate[0].course_Length, 3);
});

test("enrols successfully when the course has no sections yet", async () => {
  const { calls, deps } = createDependencies({
    course: {
      _id: new mongoose.Types.ObjectId(),
      C_title: "Empty course",
      sections: undefined,
    },
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.enrollmentCreate[0].course_Length, 0);
});

test("rejects a course whose sections field is corrupt", async () => {
  const { calls, deps } = createDependencies({
    course: {
      _id: new mongoose.Types.ObjectId(),
      C_title: "Corrupt",
      sections: "three sections",
    },
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 422);
  assert.equal(calls.enrollmentCreate.length, 0);
  assert.equal(calls.courseUpdate.length, 0);
});

test("increments the enrolled counter atomically exactly once", async () => {
  const { calls, deps } = createDependencies();
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(calls.courseUpdate.length, 1);
  assert.deepEqual(calls.courseUpdate[0].update, { $inc: { enrolled: 1 } });
});

test("is idempotent when the student is already enrolled", async () => {
  const { calls, deps } = createDependencies({
    existingEnrollment: {
      _id: new mongoose.Types.ObjectId(),
      course_Length: 2,
    },
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.alreadyEnrolled, true);
  assert.equal(calls.enrollmentCreate.length, 0);
  assert.equal(calls.paymentCreate.length, 0);
  assert.equal(calls.courseUpdate.length, 0);
});

test("finds an existing enrolment even after the course length changed", async () => {
  const { calls, deps } = createDependencies({
    course: {
      _id: new mongoose.Types.ObjectId(),
      C_title: "Grown course",
      sections: [{ S_title: "a" }, { S_title: "b" }, { S_title: "c" }],
    },
    existingEnrollment: {
      _id: new mongoose.Types.ObjectId(),
      course_Length: 2,
    },
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.body.alreadyEnrolled, true);
  assert.equal(calls.enrollmentCreate.length, 0);
  // The stored length is refreshed so progress stays accurate.
  assert.equal(calls.enrollmentUpdate.length, 1);
  assert.deepEqual(calls.enrollmentUpdate[0].update, {
    $set: { course_Length: 3 },
  });
});

test("treats a duplicate key race as already enrolled, not a 500", async () => {
  const { calls, deps } = createDependencies({
    createEnrollmentError: duplicateKeyError(),
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.alreadyEnrolled, true);
  // The loser of the race must not double count the enrolment.
  assert.equal(calls.courseUpdate.length, 0);
  assert.equal(calls.paymentCreate.length, 0);
});

test("does not write a payment row when the enrolment insert fails", async () => {
  const { calls, deps } = createDependencies({
    createEnrollmentError: new Error("write concern failed"),
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 500);
  assert.equal(calls.paymentCreate.length, 0);
  assert.equal(calls.courseUpdate.length, 0);
});

test("records the payment against the authenticated user", async () => {
  const userId = new mongoose.Types.ObjectId();
  const { calls, deps } = createDependencies();
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest({ userId }), res);

  assert.equal(calls.paymentCreate.length, 1);
  assert.equal(calls.paymentCreate[0].userId, userId.toString());
  assert.equal(calls.paymentCreate[0].status, "enrolled");
  assert.equal(calls.paymentCreate[0].amount, "free");
});

// The payment rules landed with #55. They are re-asserted here because the
// handler moved modules, and a regression would silently reopen that issue.

test("rejects a paid course enrolment with no card details", async () => {
  const { calls, deps } = createDependencies({
    course: {
      _id: new mongoose.Types.ObjectId(),
      C_title: "Paid course",
      C_price: "499",
      sections: [{ S_title: "One" }],
    },
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(calls.enrollmentCreate.length, 0);
  assert.equal(calls.paymentCreate.length, 0);
  assert.equal(calls.courseUpdate.length, 0);
});

test("rejects a paid course enrolment with an expired card", async () => {
  const { calls, deps } = createDependencies({
    course: {
      _id: new mongoose.Types.ObjectId(),
      C_title: "Paid course",
      C_price: "499",
      sections: [{ S_title: "One" }],
    },
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(
    createRequest({
      body: { cardDetails: { ...validCard, expmonthyear: "01/20" } },
    }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errors.expmonthyear, "Card expiry is missing or in the past");
  assert.equal(calls.enrollmentCreate.length, 0);
});

test("enrols in a paid course and stores only the safe card summary", async () => {
  const { calls, deps } = createDependencies({
    course: {
      _id: new mongoose.Types.ObjectId(),
      C_title: "Paid course",
      C_price: "499",
      sections: [{ S_title: "One" }],
    },
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest({ body: { cardDetails: validCard } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(calls.paymentCreate.length, 1);

  const payment = calls.paymentCreate[0];
  assert.equal(payment.amount, "499");
  assert.deepEqual(payment.cardDetails, {
    cardholdername: "A Student",
    cardLast4: "4242",
    expmonthyear: "12/2099",
  });
  // The CVV and the full card number must never reach the database.
  assert.equal(payment.cardDetails.cvvcode, undefined);
  assert.equal(payment.cardDetails.cardnumber, undefined);
});

test("does not ask a free course for card details", async () => {
  const { calls, deps } = createDependencies({
    course: {
      _id: new mongoose.Types.ObjectId(),
      C_title: "Free course",
      C_price: "0",
      sections: [{ S_title: "One" }],
    },
  });
  const controller = createEnrollCourseController(deps);
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.paymentCreate[0].amount, "free");
  assert.equal(calls.paymentCreate[0].cardDetails, undefined);
});
