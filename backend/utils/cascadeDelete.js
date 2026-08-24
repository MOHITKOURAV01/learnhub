const { removeCourseVideoFiles } = require("./courseFileCleanup");

// Deleting a user or a course was a single findByIdAndDelete with nothing after
// it. Everything pointing at the deleted row survived: enrolments, payments,
// reviews, bookmarks, activity logs, and every section video on disk.
//
// The symptoms show up all over the app. The admin dashboard populates
// userId/courseId on rows whose target is gone and renders blanks.
// getSummary() keeps counting reviews written by accounts that no longer
// exist. getEnrolledCoursesController has to defensively skip enrolments whose
// course is missing (#65) purely because nothing cleans them up.
//
// Both entry points go through here so the two cannot diverge again.

/**
 * Loads the models lazily. Requiring them at module scope would pull Mongoose
 * into every test that only wants the counting logic.
 */
function defaultModels() {
  return {
    Course: require("../schemas/courseModel"),
    EnrolledCourse: require("../schemas/enrolledCourseModel"),
    CoursePayment: require("../schemas/coursePaymentModel"),
    CourseReview: require("../schemas/courseReviewModel"),
    CourseBookmark: require("../schemas/courseBookmarkModel"),
    ActivityLog: require("../schemas/activityLogModel"),
  };
}

const deletedCount = (result) => Number(result?.deletedCount || 0);

/**
 * Removes everything that references a course, except the course itself.
 *
 * The caller deletes the course document — it may need the document first, to
 * check ownership or to collect filenames — and calls this afterwards.
 *
 * @param {string|object} courseId
 * @param {object} [options]
 * @param {object} [options.models]
 * @param {object} [options.course] the deleted document, for video cleanup
 * @param {Function} [options.cleanupFiles]
 * @returns {Promise<{ enrolments: number, payments: number, reviews: number, bookmarks: number, files: { deleted: number, failed: number } }>}
 */
async function removeCourseDependents(
  courseId,
  { models = defaultModels(), course = null, cleanupFiles = removeCourseVideoFiles } = {},
) {
  const filter = { courseId };

  const [enrolments, payments, reviews, bookmarks] = await Promise.all([
    models.EnrolledCourse.deleteMany(filter),
    models.CoursePayment.deleteMany(filter),
    models.CourseReview.deleteMany(filter),
    models.CourseBookmark.deleteMany(filter),
  ]);

  // Only the teacher-facing route used to do this. The admin route deleted the
  // row and left the .mp4 behind forever.
  const files = course
    ? await cleanupFiles(course)
    : { deleted: [], failed: [] };

  return {
    enrolments: deletedCount(enrolments),
    payments: deletedCount(payments),
    reviews: deletedCount(reviews),
    bookmarks: deletedCount(bookmarks),
    files: {
      deleted: files.deleted.length,
      failed: files.failed.length,
    },
  };
}

/**
 * Gives back the learner count a course loses when `count` enrolments go away.
 *
 * Written as `$inc: -1` guarded by `enrolled > 0` rather than a recount,
 * because `enrolled` has drifted on existing data (it was only ever
 * incremented) and a recount would silently rewrite history the admin has been
 * looking at. The guard is what stops it going negative.
 *
 * @param {Map<string, number>} countsByCourse
 * @param {object} CourseModel
 */
async function decrementEnrolledCounts(countsByCourse, CourseModel) {
  for (const [courseId, count] of countsByCourse) {
    for (let step = 0; step < count; step += 1) {
      await CourseModel.updateOne(
        { _id: courseId, enrolled: { $gt: 0 } },
        { $inc: { enrolled: -1 } },
      );
    }
  }
}

/**
 * Counts a user's enrolments per course, so the learner count on each affected
 * course can be corrected.
 *
 * @param {object[]} enrolments
 * @returns {Map<string, number>}
 */
function groupByCourse(enrolments) {
  const counts = new Map();

  for (const enrolment of enrolments) {
    if (!enrolment?.courseId) continue;

    const key = String(enrolment.courseId);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return counts;
}

/**
 * Removes everything that references a user, including courses they authored.
 *
 * The caller deletes the user document. This handles the rest.
 *
 * @param {string|object} userId
 * @param {object} [options]
 * @returns {Promise<object>} a summary suitable for the API response
 */
async function removeUserDependents(
  userId,
  { models = defaultModels(), cleanupFiles = removeCourseVideoFiles } = {},
) {
  const summary = {
    authoredCourses: 0,
    enrolments: 0,
    payments: 0,
    reviews: 0,
    bookmarks: 0,
    activityLogs: 0,
    files: { deleted: 0, failed: 0 },
  };

  // courseModel.userId is a String while every other reference is an ObjectId,
  // so authored courses are matched on the string form. Passing an ObjectId
  // here silently matches nothing.
  const authored = await models.Course.find({ userId: String(userId) }).lean();

  for (const course of authored) {
    const courseResult = await removeCourseDependents(course._id, {
      models,
      course,
      cleanupFiles,
    });

    summary.enrolments += courseResult.enrolments;
    summary.payments += courseResult.payments;
    summary.reviews += courseResult.reviews;
    summary.bookmarks += courseResult.bookmarks;
    summary.files.deleted += courseResult.files.deleted;
    summary.files.failed += courseResult.files.failed;

    await models.Course.deleteOne({ _id: course._id });
    summary.authoredCourses += 1;
  }

  // The user's own enrolments, in courses somebody else owns. Read before
  // deleting so the learner count on each course can be corrected.
  const ownEnrolments = await models.EnrolledCourse.find({ userId }).lean();

  const [enrolments, payments, reviews, bookmarks, logs] = await Promise.all([
    models.EnrolledCourse.deleteMany({ userId }),
    models.CoursePayment.deleteMany({ userId }),
    models.CourseReview.deleteMany({ userId }),
    models.CourseBookmark.deleteMany({ userId }),
    models.ActivityLog.deleteMany({ userId }),
  ]);

  await decrementEnrolledCounts(groupByCourse(ownEnrolments), models.Course);

  summary.enrolments += deletedCount(enrolments);
  summary.payments += deletedCount(payments);
  summary.reviews += deletedCount(reviews);
  summary.bookmarks += deletedCount(bookmarks);
  summary.activityLogs = deletedCount(logs);

  return summary;
}

module.exports = {
  decrementEnrolledCounts,
  defaultModels,
  groupByCourse,
  removeCourseDependents,
  removeUserDependents,
};
