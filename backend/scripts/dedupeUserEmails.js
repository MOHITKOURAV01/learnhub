// Merges accounts that share an email address.
//
// The unique index on users.email cannot be built on a collection that already
// holds duplicates, and any deployment that ran before that index existed may
// hold some: registerController checked for an existing user with a findOne and
// then wrote, so two concurrent requests both passed the check.
//
// The merge is deliberately conservative. It never invents data and never
// touches an address that only has one row.
//
//   Keeper:   a verified account beats an unverified one; between two of the
//             same, the oldest wins, because that is the one whose id is
//             already referenced by enrolments and payments.
//   Losers:   every reference to them is re-pointed at the keeper, then the
//             row is deleted. Re-pointing can collide with a row the keeper
//             already owns (both accounts enrolled in the same course), in
//             which case the loser's row is dropped rather than duplicated.
//
// Usage:
//   npm run db:dedupe-emails -- --dry-run
//   npm run db:dedupe-emails

const mongoose = require("mongoose");
const dotenv = require("dotenv");

const { normalizeEmail } = require("../utils/accountIdentity");

dotenv.config();

const User = require("../schemas/userModel");
const EnrolledCourse = require("../schemas/enrolledCourseModel");
const CoursePayment = require("../schemas/coursePaymentModel");
const CourseBookmark = require("../schemas/courseBookmarkModel");
const CourseReview = require("../schemas/courseReviewModel");
const ActivityLog = require("../schemas/activityLogModel");
const Course = require("../schemas/courseModel");

// Collections that reference a user and hold a unique constraint that a naive
// re-point could violate. `unique` names the other half of the compound key.
const OWNED_BY_USER = [
  { model: EnrolledCourse, label: "enrolments", unique: "courseId" },
  { model: CourseBookmark, label: "bookmarks", unique: "courseId" },
  { model: CourseReview, label: "reviews", unique: "courseId" },
  { model: CoursePayment, label: "payments", unique: null },
  { model: ActivityLog, label: "activity logs", unique: null },
];

/**
 * Picks the row every other row should collapse into.
 *
 * @param {object[]} accounts
 * @returns {object}
 */
function chooseKeeper(accounts) {
  const sorted = [...accounts].sort((left, right) => {
    if (Boolean(left.isVerified) !== Boolean(right.isVerified)) {
      return left.isVerified ? -1 : 1;
    }

    const leftCreated = new Date(left.createdAt || 0).getTime();
    const rightCreated = new Date(right.createdAt || 0).getTime();

    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }

    return String(left._id).localeCompare(String(right._id));
  });

  return sorted[0];
}

/**
 * Groups accounts by their normalised address.
 *
 * @param {object[]} accounts
 * @returns {Map<string, object[]>} only addresses with more than one row
 */
function groupDuplicates(accounts) {
  const byEmail = new Map();

  for (const account of accounts) {
    const key = normalizeEmail(account.email);
    if (!key) continue;

    const bucket = byEmail.get(key) || [];
    bucket.push(account);
    byEmail.set(key, bucket);
  }

  for (const [key, bucket] of byEmail) {
    if (bucket.length < 2) {
      byEmail.delete(key);
    }
  }

  return byEmail;
}

/**
 * Moves one collection's rows from a loser onto the keeper.
 *
 * @returns {Promise<{ moved: number, dropped: number }>}
 */
async function repointCollection({ model, unique }, loserId, keeperId, apply) {
  const rows = await model.find({ userId: loserId }).lean();

  if (rows.length === 0) {
    return { moved: 0, dropped: 0 };
  }

  if (!unique) {
    if (apply) {
      await model.updateMany({ userId: loserId }, { $set: { userId: keeperId } });
    }

    return { moved: rows.length, dropped: 0 };
  }

  let moved = 0;
  let dropped = 0;

  for (const row of rows) {
    const clash = await model
      .findOne({ userId: keeperId, [unique]: row[unique] })
      .lean();

    if (clash) {
      if (apply) {
        await model.deleteOne({ _id: row._id });
      }
      dropped += 1;
      continue;
    }

    if (apply) {
      await model.updateOne({ _id: row._id }, { $set: { userId: keeperId } });
    }
    moved += 1;
  }

  return { moved, dropped };
}

/**
 * @param {object} [options]
 * @param {boolean} [options.apply] false performs a dry run
 * @param {object} [options.logger]
 */
async function dedupeUserEmails({ apply = false, logger = console } = {}) {
  const accounts = await User.find()
    .select("_id email isVerified createdAt type")
    .lean();

  const duplicates = groupDuplicates(accounts);

  if (duplicates.size === 0) {
    logger.log("No duplicate email addresses found.");
    return { addresses: 0, removed: 0, details: [] };
  }

  logger.log(
    `${duplicates.size} address(es) have more than one account.` +
      (apply ? "" : " Dry run: nothing will be written."),
  );

  const details = [];
  let removed = 0;

  for (const [email, bucket] of duplicates) {
    const keeper = chooseKeeper(bucket);
    const losers = bucket.filter(
      (account) => String(account._id) !== String(keeper._id),
    );

    const summary = {
      email,
      keeper: String(keeper._id),
      losers: losers.map((loser) => String(loser._id)),
      moved: {},
      authoredCourses: 0,
    };

    for (const loser of losers) {
      for (const target of OWNED_BY_USER) {
        const { moved, dropped } = await repointCollection(
          target,
          loser._id,
          keeper._id,
          apply,
        );

        if (moved || dropped) {
          const current = summary.moved[target.label] || { moved: 0, dropped: 0 };
          summary.moved[target.label] = {
            moved: current.moved + moved,
            dropped: current.dropped + dropped,
          };
        }
      }

      // courseModel.userId is a String, not an ObjectId, so it needs its own
      // pass rather than joining the loop above.
      const authored = await Course.updateMany(
        { userId: String(loser._id) },
        { $set: { userId: String(keeper._id) } },
      ).then(
        (result) => result.modifiedCount || 0,
        () => 0,
      );

      summary.authoredCourses += authored;

      if (apply) {
        await User.deleteOne({ _id: loser._id });
      }

      removed += 1;
    }

    logger.log(
      `  ${email}: keeping ${summary.keeper}, merging ${summary.losers.length} ` +
        `duplicate(s)${summary.authoredCourses ? `, ${summary.authoredCourses} authored course(s) re-pointed` : ""}`,
    );

    details.push(summary);
  }

  logger.log(
    apply
      ? `Done. ${removed} duplicate account(s) removed.`
      : `Dry run complete. ${removed} duplicate account(s) would be removed.`,
  );

  return { addresses: duplicates.size, removed, details };
}

async function main() {
  const apply = !process.argv.includes("--dry-run");

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is required");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || "video-course-application",
  });

  try {
    await dedupeUserEmails({ apply });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Dedupe failed:", error);
    process.exit(1);
  });
}

module.exports = {
  chooseKeeper,
  dedupeUserEmails,
  groupDuplicates,
  repointCollection,
};
