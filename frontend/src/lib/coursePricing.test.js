import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FREE_PRICE_LABEL,
  coursePriceLabel,
  formatPriceLabel,
  isFreeCourse,
  isFreePrice,
  isPaidCourse,
  isPaidPrice,
  readEnrollmentError,
  readEnrollmentFieldErrors,
} from './coursePricing.js';

// #114. "Free" was decided by three rules that disagreed. The one that mattered
// most is the one in this file, because it decides whether the Enroll button
// opens the payment modal at all — and when it says free while the server says
// paid, there is no route to the payment form and the course cannot be
// enrolled in by any means.

// The same table `backend/tests/course-pricing.test.js` asserts, character for
// character. The rule exists on both sides of the wire and nothing can import
// across, so this duplication is the mechanism that keeps them together.
const CASES = [
  { price: 'free', free: true },
  { price: 'Free', free: true },
  { price: 'FREE', free: true },
  { price: '  free  ', free: true },
  { price: '0', free: true },
  { price: '00', free: true },
  { price: '0.0', free: true },
  { price: '0.00', free: true },
  { price: '  0.00 ', free: true },
  { price: '', free: true },
  { price: '   ', free: true },
  { price: null, free: true },
  { price: undefined, free: true },
  { price: '499', free: false },
  { price: '0.01', free: false },
  { price: 'Rs. 1,299', free: false },
  { price: '$29', free: false },
  { price: 'Free for the first 100', free: false },
];

test('every price in the table is classified the way the table says', () => {
  for (const { price, free } of CASES) {
    assert.equal(
      isFreePrice(price),
      free,
      `${JSON.stringify(price)} should be ${free ? 'free' : 'paid'}`,
    );
    assert.equal(isPaidPrice(price), !free);
  }
});

test('the course-shaped helpers agree with the price-shaped ones', () => {
  for (const { price, free } of CASES) {
    assert.equal(isFreeCourse({ C_price: price }), free);
    assert.equal(isPaidCourse({ C_price: price }), !free);
  }
});

test('a course with no price at all is free', () => {
  // The old rule returned early as free for undefined and null but let ''
  // fall through to the pattern and come out paid — inconsistent with itself
  // for three spellings of the same thing.
  assert.equal(isFreeCourse({}), true);
  assert.equal(isFreeCourse(null), true);
  assert.equal(isFreeCourse(undefined), true);
  assert.equal(isPaidCourse({}), false);
});

test('a price that merely mentions being free is not free', () => {
  assert.equal(isFreePrice('Free for the first 100'), false);
  assert.equal(isFreePrice('Not free'), false);
});

test('a fraction of a currency unit is not zero', () => {
  assert.equal(isFreePrice('0.01'), false);
  assert.equal(isFreePrice('0.10'), false);
});

// -- the label ---------------------------------------------------------------

test('a free course reads Free, whatever it is stored as', () => {
  assert.equal(formatPriceLabel(FREE_PRICE_LABEL), 'Free');
  assert.equal(formatPriceLabel('0.00'), 'Free');
  assert.equal(formatPriceLabel(''), 'Free');
  assert.equal(formatPriceLabel(undefined), 'Free');
});

test('a paid course reads its own price, trimmed', () => {
  assert.equal(formatPriceLabel('499'), '499');
  assert.equal(formatPriceLabel('  Rs. 1,299 '), 'Rs. 1,299');
});

test('the card never renders an empty access field', () => {
  // What a blank price used to produce: `ACCESS:` followed by nothing, on a
  // card whose Enroll button then opened a payment form.
  for (const { price } of CASES) {
    assert.notEqual(coursePriceLabel({ C_price: price }).length, 0);
  }

  assert.equal(coursePriceLabel({}), 'Free');
  assert.equal(coursePriceLabel(null), 'Free');
});

// -- reading a rejected enrolment --------------------------------------------

test("the server's own message is preferred over the generic one", () => {
  // The 400 that the pricing mismatch produced. It says exactly what is wrong;
  // AllCourses used to throw it away and alert "Please try again." forever.
  const error = {
    response: {
      status: 400,
      data: {
        success: false,
        message:
          'Cardholder name is required. Card number is not valid. Card expiry is missing or in the past. Security code is not valid',
      },
    },
  };

  assert.match(readEnrollmentError(error), /Cardholder name is required/);
});

test('a failure with no message still says something useful', () => {
  assert.equal(
    readEnrollmentError({}),
    'Enrollment could not be completed. Please try again.',
  );
  assert.equal(
    readEnrollmentError({ response: { status: 500, data: {} } }),
    'Enrollment could not be completed. Please try again.',
  );
  assert.equal(
    readEnrollmentError({ response: { status: 500, data: { message: '   ' } } }),
    'Enrollment could not be completed. Please try again.',
  );
});

test('an expired session says so rather than blaming the card', () => {
  assert.equal(
    readEnrollmentError({ response: { status: 401, data: {} } }),
    'Please sign in again to enroll.',
  );
});

test('the per-field errors come back as a plain map', () => {
  const error = {
    response: {
      data: {
        errors: {
          cardnumber: 'Card number is not valid',
          expmonthyear: 'Card expiry is missing or in the past',
        },
      },
    },
  };

  assert.deepEqual(readEnrollmentFieldErrors(error), {
    cardnumber: 'Card number is not valid',
    expmonthyear: 'Card expiry is missing or in the past',
  });
});

test('a missing or malformed errors block is an empty map, not a crash', () => {
  assert.deepEqual(readEnrollmentFieldErrors({}), {});
  assert.deepEqual(readEnrollmentFieldErrors({ response: { data: {} } }), {});
  assert.deepEqual(
    readEnrollmentFieldErrors({ response: { data: { errors: null } } }),
    {},
  );
  assert.deepEqual(
    readEnrollmentFieldErrors({ response: { data: { errors: ['nope'] } } }),
    {},
  );
  assert.deepEqual(
    readEnrollmentFieldErrors({ response: { data: { errors: { a: 42, b: '  ' } } } }),
    {},
  );
});
