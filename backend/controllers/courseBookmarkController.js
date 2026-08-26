const mongoose = require("mongoose");
const CourseBookmark = require("../schemas/courseBookmarkModel");
const Course = require("../schemas/courseModel");
const {
  bookmarkAggregateOptions,
  buildBookmarkPipeline,
  clampedPage,
  parseSavedCoursesQuery,
  readBookmarkFacet,
} = require("../utils/bookmarkListing");

// #107. getSavedCourses read the user's entire bookmark collection on every
// request, populated a course document for each row, and then filtered, sorted,
// counted and sliced in Node — to return a page of twelve. serializeCourse and
// its per-row regex ran over every saved course to produce those twelve, and
// the category list was rebuilt by walking all of them into a Set.
//
// The load was multiplied by how the client used it: BookmarksProvider called
// the endpoint on mount and after every clear, and SavedCourses re-ran it on
// each learnhub:bookmark-change event, so saving five courses in a row on the
// wishlist meant five full reads.
//
// utils/bookmarkListing.js owns the pipeline and the shaping now; the query
// runs once, in the database.

const getUserId = (req) =>
  req.user?._id?.toString() || req.body?.userId || null;

/**
 * $lookup needs a collection name, not a model. Reading it off the model rather
 * than writing "courses" as a literal means a change to Mongoose's
 * pluralisation cannot silently make every join return nothing.
 */
const courseCollectionName = () => Course?.collection?.name || "courses";

/**
 * find() casts a string id against the schema; aggregate() does not.
 *
 * getUserId returns `req.user._id.toString()`, and `$match: { userId: "<hex>" }`
 * against an ObjectId field matches nothing at all — silently, as an empty
 * wishlist rather than as an error. The cast has to be explicit here.
 */
const toUserObjectId = (userId) =>
  mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(String(userId))
    : userId;

const addBookmark = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { courseId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).send({
        success: false,
        message: "A valid course and authenticated user are required.",
      });
    }

    const course = await Course.findById(courseId)
      .select("_id C_title")
      .lean();

    if (!course) {
      return res.status(404).send({
        success: false,
        message: "Course not found.",
      });
    }

    const result = await CourseBookmark.findOneAndUpdate(
      { userId, courseId },
      { $setOnInsert: { userId, courseId } },
      { upsert: true, new: true, rawResult: true },
    );

    const created = Boolean(result?.lastErrorObject?.upserted);

    return res.status(created ? 201 : 200).send({
      success: true,
      created,
      bookmarked: true,
      courseId,
      message: created
        ? "Course saved successfully."
        : "Course was already saved.",
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(200).send({
        success: true,
        created: false,
        bookmarked: true,
        courseId: req.params.courseId,
        message: "Course was already saved.",
      });
    }

    console.error("Unable to save course bookmark:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to save this course.",
    });
  }
};

const removeBookmark = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID.",
      });
    }

    const result = await CourseBookmark.deleteOne({ userId, courseId });

    return res.status(200).send({
      success: true,
      bookmarked: false,
      removed: result.deletedCount > 0,
      courseId,
      message:
        result.deletedCount > 0
          ? "Course removed from saved courses."
          : "Course was not in your saved courses.",
    });
  } catch (error) {
    console.error("Unable to remove course bookmark:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to remove this saved course.",
    });
  }
};

const getBookmarkStatus = async (req, res) => {
  try {
    const userId = getUserId(req);
    const rawIds = [
      ...String(req.query.courseIds || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
      ...(Array.isArray(req.query.courseId)
        ? req.query.courseId
        : req.query.courseId
          ? [req.query.courseId]
          : []),
    ];

    const courseIds = [...new Set(rawIds)].filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );

    if (courseIds.length > 100) {
      return res.status(400).send({
        success: false,
        message: "A maximum of 100 course IDs can be checked at once.",
      });
    }

    const bookmarks = await CourseBookmark.find({
      userId,
      courseId: { $in: courseIds },
    })
      .select("courseId")
      .lean();

    return res.status(200).send({
      success: true,
      data: bookmarks.map((bookmark) =>
        bookmark.courseId.toString(),
      ),
      count: bookmarks.length,
    });
  } catch (error) {
    console.error("Unable to retrieve bookmark status:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to retrieve bookmark status.",
    });
  }
};

const getSavedCourses = async (req, res) => {
  try {
    const userId = getUserId(req);
    const parsed = parseSavedCoursesQuery(req.query || {});

    if (!parsed.valid) {
      return res.status(400).send({
        success: false,
        message: parsed.message,
      });
    }

    const filters = parsed.value;
    const options = { courseCollection: courseCollectionName() };

    const runPipeline = async (pageFilters) => {
      const [facet] = await CourseBookmark.aggregate(
        buildBookmarkPipeline(toUserObjectId(userId), pageFilters, options),
      ).option(bookmarkAggregateOptions(pageFilters));

      return readBookmarkFacet(facet, pageFilters);
    };

    let result = await runPipeline(filters);

    // The old code clamped an over-large page by slicing an array it had
    // already materialised. An aggregation has skipped past the end before it
    // knows the total, so an out-of-range page is detected from the count and
    // re-run once — and only when the client asked for a page that does not
    // exist.
    const retryPage = clampedPage(filters, result.pagination.totalItems);

    if (retryPage !== null) {
      result = await runPipeline({ ...filters, page: retryPage });
    }

    return res.status(200).send({
      success: true,
      data: result.data,
      categories: result.categories,
      pagination: result.pagination,
      filters: {
        search: filters.search,
        category: filters.category,
        access: filters.access,
        availability: filters.availability,
        sort: filters.sort,
      },
    });
  } catch (error) {
    console.error("Unable to retrieve saved courses:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to retrieve saved courses.",
    });
  }
};

const clearBookmarks = async (req, res) => {
  try {
    const userId = getUserId(req);
    const result = await CourseBookmark.deleteMany({ userId });

    return res.status(200).send({
      success: true,
      removedCount: result.deletedCount,
      message: "Saved courses cleared successfully.",
    });
  } catch (error) {
    console.error("Unable to clear saved courses:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to clear saved courses.",
    });
  }
};

module.exports = {
  addBookmark,
  removeBookmark,
  getBookmarkStatus,
  getSavedCourses,
  clearBookmarks,
};
