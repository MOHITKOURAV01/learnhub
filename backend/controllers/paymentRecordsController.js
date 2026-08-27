const coursePaymentSchema = require("../schemas/coursePaymentModel");
const {
  buildPaymentPipeline,
  clampedPage,
  parsePaymentQuery,
  readPaymentFacet,
} = require("../utils/paymentListing");

// #104. This endpoint accepted page, limit, search, status and sort, and
// applied exactly one of them to the database. The find() carried the date
// range; everything else — search, status, ordering, the summary totals and the
// slice — ran in Node over every payment row in the collection, with a populate
// into users and a populate into courses for all of them, to return a page of
// at most fifty.
//
// A payment row is written on every enrolment, free courses included, by
// enrollCourseController, so this is the admin table that grows fastest. It is
// the same defect #96 fixed for the user and course lists.
//
// The whole thing is one aggregation now. utils/paymentListing.js owns the
// pipeline and the shaping; this file is the HTTP edge.

/**
 * Resolves a Mongoose model's real collection name.
 *
 * $lookup needs the collection, not the model. Reading it off the model rather
 * than writing "users" and "courses" as literals means a change to the
 * pluralisation cannot silently make every join return nothing.
 */
const collectionNameOf = (model, fallback) =>
  model?.collection?.name || fallback;

const getAdminPaymentsController = async (req, res) => {
  try {
    const parsed = parsePaymentQuery(req.query || {});

    if (!parsed.valid) {
      return res.status(400).send({
        success: false,
        message: parsed.message,
      });
    }

    const filters = parsed.value;

    const collections = {
      userCollection: collectionNameOf(
        coursePaymentSchema.db?.models?.user,
        "users",
      ),
      courseCollection: collectionNameOf(
        coursePaymentSchema.db?.models?.course,
        "courses",
      ),
    };

    const runPipeline = async (pageFilters) => {
      const [facet] = await coursePaymentSchema.aggregate(
        buildPaymentPipeline(pageFilters, collections),
      );

      return readPaymentFacet(facet, pageFilters);
    };

    let result = await runPipeline(filters);

    // The old code clamped an over-large page by slicing an array it had
    // already materialised. An aggregation has skipped past the end before it
    // knows the total, so an out-of-range page is detected from the count and
    // re-run once — at most two round trips, and only when the client asked for
    // a page that does not exist.
    const retryPage = clampedPage(filters, result.pagination.totalItems);

    if (retryPage !== null) {
      result = await runPipeline({ ...filters, page: retryPage });
    }

    return res.status(200).send({
      success: true,
      data: result.data,
      summary: result.summary,
      pagination: result.pagination,
      filters: {
        search: filters.search,
        status: filters.status,
        startDate: filters.startDate?.toISOString() || null,
        endDate: filters.endDate?.toISOString() || null,
        sort: filters.sort,
      },
    });
  } catch (error) {
    console.error("Unable to retrieve payment records:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to retrieve payment records.",
    });
  }
};

module.exports = {
  getAdminPaymentsController,
};
