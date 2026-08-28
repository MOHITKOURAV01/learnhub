const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FREE_PRICE_LABEL,
  FREE_PRICE_PATTERN,
  accessTypeExpression,
  formatPriceLabel,
  freePriceFilterClauses,
  isFreeCourse,
  isFreePrice,
  isPaidCourse,
  isPaidPrice,
  normalizeCoursePrice,
  paidPriceFilterClauses,
} = require("../utils/coursePricing");

const { buildCourseFilter } = require("../utils/courseListing");
const { isFreeCourse: checkoutIsFree } = require("../utils/paymentDetails");
const { validateCourseSubmission } = require("../utils/courseInput");

// #114. "Free" was decided by three rules that disagreed:
//
//   utils/courseListing.js   /^\s*(?:free|0(?:\.0+)?)\s*$/i
//   utils/paymentDetails.js  new Set(["", "0", "free"])
//   utils/bookmarkListing.js /[0-9]/ anywhere means paid
//
// A course priced "0.00" was free to the catalogue and paid to checkout, so
// the Enroll button skipped the payment modal and the server then rejected the
// resulting request for carrying no card details. There was no route to the
// payment form, because the UI did not believe there was anything to pay.

// The table the issue was filed with. Every rule in the project has to answer
// the middle column for every row of it. `frontend/src/lib/coursePricing.test.js`
// asserts the same table, so the two halves of the same question cannot drift.
const CASES = [
  { price: "free", free: true },
  { price: "Free", free: true },
  { price: "FREE", free: true },
  { price: "  free  ", free: true },
  { price: "0", free: true },
  { price: "00", free: true },
  { price: "0.0", free: true },
  { price: "0.00", free: true },
  { price: "  0.00 ", free: true },
  { price: "", free: true },
  { price: "   ", free: true },
  { price: null, free: true },
  { price: undefined, free: true },
  { price: "499", free: false },
  { price: "0.01", free: false },
  { price: "Rs. 1,299", free: false },
  { price: "$29", free: false },
  { price: "Free for the first 100", free: false },
];

// -- the rule ----------------------------------------------------------------

test("every price in the table is classified the way the table says", () => {
  for (const { price, free } of CASES) {
    assert.equal(
      isFreePrice(price),
      free,
      `${JSON.stringify(price)} should be ${free ? "free" : "paid"}`,
    );
    assert.equal(isPaidPrice(price), !free);
  }
});

test("an absent price is free, because that is what the server charges for it", () => {
  // enrollCourseController writes `amount: "free"` and asks for no card
  // details when this is true. The catalogue used to disagree and render a
  // card reading "ACCESS:" followed by nothing, then open a payment form.
  assert.equal(isFreePrice(undefined), true);
  assert.equal(isFreePrice(null), true);
  assert.equal(isFreePrice(""), true);
  assert.equal(isFreePrice("   "), true);
});

test("a price that merely contains the word free is not free", () => {
  // The wishlist's old `/[0-9]/` rule got this one right and the catalogue's
  // pattern got it right too. It stays right.
  assert.equal(isFreePrice("Free for the first 100"), false);
  assert.equal(isFreePrice("Not free"), false);
});

test("a fraction of a currency unit is not zero", () => {
  assert.equal(isFreePrice("0.01"), false);
  assert.equal(isFreePrice("0.10"), false);
});

test("the course-shaped helpers read C_price off the document", () => {
  assert.equal(isFreeCourse({ C_price: "0.00" }), true);
  assert.equal(isPaidCourse({ C_price: "499" }), true);
  assert.equal(isFreeCourse({}), true);
  assert.equal(isFreeCourse(null), true);
  assert.equal(isFreeCourse(undefined), true);
});

// -- the three call sites now agree ------------------------------------------

test("checkout classifies every price the same way the rule does", () => {
  // utils/paymentDetails is the gate that decides whether money is asked for.
  // Before this it called "0.00" paid while the catalogue called it free.
  for (const { price, free } of CASES) {
    assert.equal(
      checkoutIsFree(price),
      free,
      `checkout disagrees on ${JSON.stringify(price)}`,
    );
  }
});

test("the catalogue filter selects exactly the courses the rule calls free", () => {
  const clauses = buildCourseFilter({ priceType: "free" }).$and[0].$or;

  const selected = (price) => {
    if (price === undefined) {
      return clauses.some((clause) => clause.C_price?.$exists === false);
    }
    if (price === null) {
      return clauses.some((clause) => clause.C_price === null);
    }
    return clauses.some((clause) => clause.C_price?.$regex?.test(price));
  };

  for (const { price, free } of CASES) {
    assert.equal(
      selected(price),
      free,
      `the free filter disagrees on ${JSON.stringify(price)}`,
    );
  }
});

test("the paid filter is the exact complement of the free one", () => {
  const clauses = paidPriceFilterClauses();

  // Same three clauses as before, so the existing assertions on shape hold.
  assert.equal(clauses.length, 3);
  assert.equal(clauses[2].C_price.$not, FREE_PRICE_PATTERN);

  for (const { price, free } of CASES) {
    if (price === undefined || price === null) continue;

    const kept =
      !clauses[1].C_price.$not.test(price) &&
      !clauses[2].C_price.$not.test(price);

    assert.equal(
      kept,
      !free,
      `the paid filter disagrees on ${JSON.stringify(price)}`,
    );
  }
});

test("the free filter is expressed as clauses, not one regex", () => {
  // A regex cannot match a field that does not exist, and an absent price is
  // free. This is why the shape had to change.
  const clauses = freePriceFilterClauses();

  assert.equal(clauses.length, 4);
  assert.ok(clauses.some((clause) => clause.C_price?.$exists === false));
  assert.ok(clauses.some((clause) => clause.C_price === null));
});

// -- the aggregation form ----------------------------------------------------

test("the aggregation expression yields the same two values", () => {
  const expression = accessTypeExpression("$course.C_price");

  assert.deepEqual(expression.$cond.slice(1), ["free", "paid"]);
  assert.equal(expression.$cond[0].$regexMatch.options, "i");
  assert.deepEqual(expression.$cond[0].$regexMatch.input, {
    $ifNull: ["$course.C_price", ""],
  });
});

test("the aggregation pattern classifies the table like the rule does", () => {
  // $regexMatch takes a string pattern, so the source is duplicated as a
  // string rather than shared as a RegExp. This is the test that keeps the two
  // spellings of the same rule honest.
  const { regex, options } = accessTypeExpression().$cond[0].$regexMatch;
  const pattern = new RegExp(regex, options);

  for (const { price, free } of CASES) {
    // $ifNull turns a missing value into "", which the pattern's blank branch
    // matches — the same place isFreePrice puts it.
    const input = price === null || price === undefined ? "" : price;

    assert.equal(
      pattern.test(input),
      free,
      `the aggregation rule disagrees on ${JSON.stringify(price)}`,
    );
  }
});

test("the aggregation expression takes the field path it is given", () => {
  assert.deepEqual(accessTypeExpression("$C_price").$cond[0].$regexMatch.input, {
    $ifNull: ["$C_price", ""],
  });
});

// -- writing and displaying --------------------------------------------------

test("every free form collapses to one stored label", () => {
  for (const { price, free } of CASES) {
    const stored = normalizeCoursePrice(price);

    if (free) {
      assert.equal(stored, FREE_PRICE_LABEL);
    } else {
      assert.equal(stored, String(price).trim());
    }
  }
});

test("a stored price is trimmed and capped", () => {
  assert.equal(normalizeCoursePrice("  499  "), "499");
  assert.equal(normalizeCoursePrice("9".repeat(80)).length, 40);
  assert.equal(normalizeCoursePrice("9".repeat(80), { maxLength: 5 }), "99999");
});

test("a normalised price still reads as free to the rule", () => {
  // The write rule and the read rule are the same rule, so this is a tautology
  // now. It was not before: courseInput normalised on FREE_PRICE_PATTERN while
  // paymentDetails read the result through a different set.
  for (const { price } of CASES) {
    assert.equal(isFreePrice(normalizeCoursePrice(price)), isFreePrice(price));
  }
});

test("a free course displays as Free rather than as its stored label", () => {
  assert.equal(formatPriceLabel("free"), "Free");
  assert.equal(formatPriceLabel("0.00"), "Free");
  assert.equal(formatPriceLabel(""), "Free");
  assert.equal(formatPriceLabel(undefined), "Free");
  assert.equal(formatPriceLabel("499"), "499");
  assert.equal(formatPriceLabel("  Rs. 1,299 "), "Rs. 1,299");
});

// -- the write path end to end -----------------------------------------------

test("a course submitted at 0.00 is stored as free and enrols without payment", () => {
  // The reported bug, closed at both ends: what gets written, and what
  // checkout then makes of it.
  const submission = validateCourseSubmission({
    body: {
      C_title: "Intro to CSS",
      C_categories: "Web",
      C_description: "d",
      C_price: "0.00",
    },
    files: [{ filename: "a.mp4" }],
    user: { _id: "u1", name: "Tess" },
  });

  assert.equal(submission.valid, true);
  assert.equal(submission.value.C_price, FREE_PRICE_LABEL);
  assert.equal(checkoutIsFree(submission.value.C_price), true);
});

test("a course submitted with a real price still costs money", () => {
  const submission = validateCourseSubmission({
    body: {
      C_title: "Advanced CSS",
      C_categories: "Web",
      C_description: "d",
      C_price: "499",
    },
    files: [{ filename: "a.mp4" }],
    user: { _id: "u1", name: "Tess" },
  });

  assert.equal(submission.value.C_price, "499");
  assert.equal(checkoutIsFree(submission.value.C_price), false);
});

test("a repeated multipart price field does not become an array", () => {
  // C_price=0.00&C_price=999 arrives as ["0.00", "999"]. The first value wins,
  // as it does for every other single-valued field on this route.
  const submission = validateCourseSubmission({
    body: {
      C_title: "Intro",
      C_categories: "Web",
      C_description: "d",
      C_price: ["0.00", "999"],
    },
    files: [{ filename: "a.mp4" }],
    user: { _id: "u1", name: "Tess" },
  });

  assert.equal(submission.value.C_price, FREE_PRICE_LABEL);
});
