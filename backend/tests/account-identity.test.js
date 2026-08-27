const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  buildEmailFilter,
  duplicateKeyFields,
  isDuplicateKeyError,
  isDuplicateOn,
  normalizeEmail,
} = require("../utils/accountIdentity");

const {
  chooseKeeper,
  groupDuplicates,
} = require("../scripts/dedupeUserEmails");

const { describeIndexFailure } = require("../config/ensureIndexes");

const userSchema = require("../schemas/userModel");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

// -- normalisation -----------------------------------------------------------

test("an address is trimmed and lowercased for lookup", () => {
  assert.equal(normalizeEmail("  User@Example.COM  "), "user@example.com");
  assert.equal(normalizeEmail("already@lower.com"), "already@lower.com");
});

test("a value that is not a string normalises to empty rather than throwing", () => {
  for (const value of [undefined, null, 42, {}, [], true]) {
    assert.equal(normalizeEmail(value), "");
  }
});

test("dots and plus tags are left alone", () => {
  // Collapsing these would merge accounts that a self-hosted domain treats as
  // genuinely different people.
  assert.equal(normalizeEmail("a.b+tag@example.com"), "a.b+tag@example.com");
});

test("an unusable address produces a filter that cannot match anything", () => {
  // findOne(null) is findOne({}) in Mongoose and would return an arbitrary
  // account, so the filter has to stay an object with an unmatchable value.
  for (const value of [undefined, null, "   ", {}, 7]) {
    const filter = buildEmailFilter(value);

    assert.equal(typeof filter, "object");
    assert.notEqual(filter, null);
    assert.equal(filter.email, "");
  }
});

test("a usable address produces the normalised filter", () => {
  assert.deepEqual(buildEmailFilter(" Race@Example.com "), {
    email: "race@example.com",
  });
});

// -- duplicate key detection -------------------------------------------------

test("a driver duplicate key error is recognised", () => {
  const error = Object.assign(new Error("E11000 duplicate key error"), {
    code: 11000,
    keyPattern: { email: 1 },
    keyValue: { email: "race@example.com" },
  });

  assert.equal(isDuplicateKeyError(error), true);
  assert.deepEqual(duplicateKeyFields(error), ["email"]);
  assert.equal(isDuplicateOn(error, "email"), true);
  assert.equal(isDuplicateOn(error, "name"), false);
});

test("a bulk write duplicate is recognised through writeErrors", () => {
  const error = Object.assign(new Error("bulk write failed"), {
    writeErrors: [{ code: 11000, keyValue: { email: "race@example.com" } }],
  });

  assert.equal(isDuplicateKeyError(error), true);
  assert.deepEqual(duplicateKeyFields(error), ["email"]);
});

test("an older driver that only names the index in the message still resolves", () => {
  const error = Object.assign(
    new Error(
      'E11000 duplicate key error collection: learnhub.users index: email_1 dup key: { email: "race@example.com" }',
    ),
    { code: 11000 },
  );

  assert.deepEqual(duplicateKeyFields(error), ["email"]);
});

test("an unrelated error is not mistaken for a duplicate", () => {
  assert.equal(isDuplicateKeyError(new Error("connection reset")), false);
  assert.equal(isDuplicateKeyError(undefined), false);
  assert.equal(isDuplicateKeyError("E11000"), false);
  assert.deepEqual(duplicateKeyFields(new Error("nope")), []);
});

// -- startup diagnostics -----------------------------------------------------

test("a blocked user index build explains how to unblock it", () => {
  const error = Object.assign(new Error("E11000"), {
    code: 11000,
    keyValue: { email: "race@example.com" },
  });

  const message = describeIndexFailure("user", error);

  assert.match(message, /duplicate addresses/);
  assert.match(message, /db:dedupe-emails/);
  assert.match(message, /race@example\.com/);
});

test("a non-duplicate index failure is reported verbatim", () => {
  const message = describeIndexFailure("course", new Error("disk full"));

  assert.match(message, /course/);
  assert.match(message, /disk full/);
});

// -- dedupe selection --------------------------------------------------------

test("only addresses with more than one account are grouped", () => {
  const groups = groupDuplicates([
    { _id: "1", email: "solo@example.com" },
    { _id: "2", email: "dup@example.com" },
    { _id: "3", email: "DUP@example.com" },
  ]);

  assert.equal(groups.size, 1);
  assert.equal(groups.get("dup@example.com").length, 2);
});

test("a verified account is kept over an unverified one", () => {
  const keeper = chooseKeeper([
    { _id: "b", isVerified: false, createdAt: new Date(0) },
    { _id: "a", isVerified: true, createdAt: new Date(1000) },
  ]);

  assert.equal(keeper._id, "a");
});

test("between two equally verified accounts the oldest is kept", () => {
  // The oldest id is the one enrolments and payments already point at.
  const keeper = chooseKeeper([
    { _id: "new", isVerified: true, createdAt: new Date(2000) },
    { _id: "old", isVerified: true, createdAt: new Date(1000) },
  ]);

  assert.equal(keeper._id, "old");
});

// -- the index itself --------------------------------------------------------

test("the unique email index rejects a second account for the same address", async (t) => {
  await startTestDatabase();

  t.after(async () => {
    await stopTestDatabase();
  });

  await clearTestDatabase();
  await userSchema.createIndexes();

  await userSchema.create({
    name: "First",
    email: "race@example.com",
    password: "hashed",
    type: "student",
  });

  await assert.rejects(
    () =>
      userSchema.create({
        name: "Second",
        email: "race@example.com",
        password: "hashed",
        type: "student",
      }),
    (error) => {
      assert.equal(isDuplicateOn(error, "email"), true);
      return true;
    },
  );

  // The setter lowercases before the index is consulted, so a differently
  // cased address is the same address.
  await assert.rejects(() =>
    userSchema.create({
      name: "Third",
      email: "RACE@Example.com",
      password: "hashed",
      type: "student",
    }),
  );

  assert.equal(
    await userSchema.countDocuments({ email: "race@example.com" }),
    1,
  );

  // And the normalised filter finds it however the client cased it.
  const found = await userSchema.findOne(buildEmailFilter(" RaCe@EXAMPLE.com "));
  assert.ok(found);
  assert.equal(found.name, "First");

  assert.equal(mongoose.connection.readyState, 1);
});
