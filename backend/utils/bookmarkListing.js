// Query building for GET /api/bookmarks.
//
// getSavedCourses read the user's entire bookmark collection on every request,
// populated a course document for each row, and then did all of the work in
// Node:
//
//   const bookmarkDocs = await CourseBookmark.find({ userId })
//     .populate({ path: "courseId", select: "..." })
//     .sort({ createdAt: -1 })
//     .lean();
//
//   let items = bookmarkDocs.map(...)
//   if (search)       { items = items.filter(...) }
//   if (category)     { items = items.filter(...) }
//   if (access)       { items = items.filter(...) }
//   if (availability) { items = items.filter(...) }
//   items.sort(sorters[sort]);
//   ...items.slice(start, start + limit)
//
// No skip, no limit, every filter and sort over the fully materialised list, and
// serializeCourse — which runs a regex per row through parsePrice — executed for
// every saved course to produce a page of twelve (#107).
//
// The load was multiplied by how the client used it. BookmarksProvider called
// the endpoint on mount and after every clear, and SavedCourses re-ran it on
// each learnhub:bookmark-change event, so saving five courses in a row on the
// wishlist page meant five full reads.
//
// It is the same defect #96 fixed for the admin user and course lists.
//
// One thing genuinely has to see every row: the `categories` list is built from
// *all* of the user's bookmarks, not the filtered ones, because it populates the
// category dropdown and that must not shrink as the user filters with it. So the
// join is bounded by the user's bookmark count either way — but everything else
// moves into the database, and the join returns six projected fields per course
// rather than a whole document.

const { escapeRegex, normalizeText } = require("./courseListing");
const { accessTypeExpression } = require("./coursePricing");

const ALLOWED_SORTS = new Set([
  "recent",
  "title-asc",
  "title-desc",
  "price-asc",
  "price-desc",
]);

const ALLOWED_ACCESS = new Set(["free", "paid"]);
const ALLOWED_AVAILABILITY = new Set(["available", "deleted"]);

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

// The strings serializeCourse substituted for a course that no longer exists.
// Kept exactly: the wishlist renders them, and they are searchable.
const MISSING_COURSE = Object.freeze({
  title: "Course unavailable",
  category: "Unavailable",
  educator: "Unknown",
  description: "This saved course is no longer available in the catalog.",
});

// Case- and accent-aware ordering, so title-asc still behaves like the
// localeCompare it replaces rather than sorting every uppercase title first.
const TITLE_COLLATION = Object.freeze({ locale: "en", strength: 2 });

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} maximum
 * @returns {number}
 */
function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(
    Array.isArray(value) ? value[0] : value,
    10,
  );

  if (!Number.isFinite(parsed) || parsed < 1) return fallback;

  return Math.min(parsed, maximum);
}

/**
 * Validates the query string.
 *
 * Every rejection the old controller produced is reproduced, with the same
 * message, so a bad request behaves exactly as it did.
 *
 * @param {object} [query]
 * @returns {{ valid: boolean, message?: string, value?: object }}
 */
function parseSavedCoursesQuery(query = {}) {
  const page = parsePositiveInteger(query.page, 1, 100000);
  const limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const category = normalizeText(query.category, 80);
  const access = normalizeText(query.access, 20).toLowerCase();
  const availability = normalizeText(query.availability, 20).toLowerCase();
  const search = normalizeText(query.search, 120).toLowerCase();
  const sort = normalizeText(query.sort, 30).toLowerCase() || "recent";

  if (access && !ALLOWED_ACCESS.has(access)) {
    return { valid: false, message: "Invalid access filter." };
  }

  if (availability && !ALLOWED_AVAILABILITY.has(availability)) {
    return { valid: false, message: "Invalid availability filter." };
  }

  if (!ALLOWED_SORTS.has(sort)) {
    return { valid: false, message: "Invalid saved-course sort option." };
  }

  return {
    valid: true,
    value: { page, limit, category, access, availability, search, sort },
  };
}

/**
 * Whether the joined course counts as paid.
 *
 * This was `/[0-9]/` — any digit anywhere — and a comment saying the looseness
 * was kept deliberately, because tightening it moves courses between the Free
 * and Paid filters on wishlists people have already saved.
 *
 * That reasoning held while there was no shared rule to move towards. There is
 * one now (#114), and the looseness was not harmless: a course priced "0" read
 * Free on its catalogue card and Paid on the wishlist card next to it, and the
 * wishlist's Free filter hid it.
 *
 * So it is aligned, and the behaviour change is real and worth stating: a
 * saved course whose price reads as zero moves from Paid to Free here. It
 * moves *onto* the label the catalogue has always shown it under, which is the
 * point. Nothing is stored per bookmark — accessType is computed on read — so
 * there is no data migration and no way for the two to drift back apart.
 */
const ACCESS_EXPRESSION = accessTypeExpression("$course.C_price");

/**
 * The numeric price, for the two price sorts.
 *
 * parsePrice stripped everything but digits, dots and minus signs and ran
 * parseFloat. Commas are removed first here so a grouped number is not
 * truncated, then the first numeric run is taken; no numeric run at all — a free
 * course — is 0, which is what parsePrice returned.
 */
const PRICE_EXPRESSION = {
  $cond: [
    { $eq: [ACCESS_EXPRESSION, "free"] },
    0,
    {
      $let: {
        vars: {
          digits: {
            $regexFind: {
              input: {
                $replaceAll: {
                  input: { $ifNull: ["$course.C_price", ""] },
                  find: ",",
                  replacement: "",
                },
              },
              regex: "[0-9]+(?:\\.[0-9]+)?",
            },
          },
        },
        in: {
          $convert: {
            input: { $ifNull: ["$$digits.match", "0"] },
            to: "double",
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
  ],
};

/**
 * The fields the filters and the sorts are expressed over.
 *
 * A course that was deleted resolves to nothing after the $unwind, so each field
 * falls back to the placeholder serializeCourse used — which keeps those rows
 * searchable, as they were.
 */
const COMPUTED_FIELDS = Object.freeze({
  availability: {
    $cond: [{ $ifNull: ["$course._id", false] }, "available", "deleted"],
  },
  accessType: ACCESS_EXPRESSION,
  numericPrice: PRICE_EXPRESSION,
  titleValue: { $ifNull: ["$course.C_title", MISSING_COURSE.title] },
  categoryValue: {
    $ifNull: ["$course.C_categories", MISSING_COURSE.category],
  },
  searchText: {
    $concat: [
      { $ifNull: ["$course.C_title", MISSING_COURSE.title] },
      " ",
      { $ifNull: ["$course.C_categories", MISSING_COURSE.category] },
      " ",
      { $ifNull: ["$course.C_educator", MISSING_COURSE.educator] },
      " ",
      { $ifNull: ["$course.C_description", MISSING_COURSE.description] },
    ],
  },
});

/**
 * The stages that narrow the user's bookmarks to what the filters asked for.
 *
 * Returned as a list rather than pushed, because they run inside two separate
 * $facet branches — the rows and the count — while the category list
 * deliberately runs without them.
 *
 * @param {object} filters
 * @returns {object[]}
 */
function buildFilterStages(filters = {}) {
  const { search, category, access, availability } = filters;
  const stages = [];

  if (search) {
    // escapeRegex is not optional: the value goes into a regex, and a bare "("
    // is enough to turn a search box into a 500.
    stages.push({
      $match: { searchText: { $regex: escapeRegex(search), $options: "i" } },
    });
  }

  if (category) {
    stages.push({
      $match: {
        categoryValue: {
          $regex: `^${escapeRegex(category)}$`,
          $options: "i",
        },
      },
    });
  }

  if (access) {
    stages.push({ $match: { accessType: access } });
  }

  if (availability) {
    stages.push({ $match: { availability } });
  }

  return stages;
}

/**
 * The sort, always with an _id tiebreak.
 *
 * The old in-memory comparators had none, so two courses saved in the same
 * millisecond — ordinary, because the wishlist page saves in bursts — could swap
 * places between two requests and make a card appear on both page one and page
 * two, or on neither.
 *
 * @param {string} sort
 * @returns {object}
 */
function buildBookmarkSort(sort) {
  switch (sort) {
    case "title-asc":
      return { titleValue: 1, _id: 1 };

    case "title-desc":
      return { titleValue: -1, _id: -1 };

    case "price-asc":
      return { numericPrice: 1, _id: 1 };

    case "price-desc":
      return { numericPrice: -1, _id: -1 };

    case "recent":
    default:
      return { createdAt: -1, _id: -1 };
  }
}

/**
 * Builds the whole aggregation.
 *
 * @param {string|object} userId
 * @param {object} filters as returned by parseSavedCoursesQuery
 * @param {object} [options]
 * @param {string} [options.courseCollection]
 * @returns {object[]}
 */
function buildBookmarkPipeline(userId, filters = {}, options = {}) {
  const { courseCollection = "courses" } = options;
  const { page, limit, sort } = filters;
  const skip = (Math.max(1, page || 1) - 1) * (limit || DEFAULT_LIMIT);

  const filterStages = buildFilterStages(filters);

  return [
    // courseBookmarkModel indexes { userId: 1, createdAt: -1 }.
    { $match: { userId } },
    {
      $lookup: {
        from: courseCollection,
        localField: "courseId",
        foreignField: "_id",
        as: "course",
        // Six fields, not the whole course document. The old populate asked for
        // the same set, but there is no reason to carry sections through a join.
        pipeline: [
          {
            $project: {
              C_title: 1,
              C_categories: 1,
              C_educator: 1,
              C_description: 1,
              C_price: 1,
              enrolled: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
      },
    },
    // preserveNullAndEmptyArrays, or a bookmark whose course was deleted would
    // disappear from the wishlist instead of showing as unavailable — which is
    // the entire point of the `deleted` availability filter.
    { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
    { $addFields: COMPUTED_FIELDS },
    {
      $facet: {
        rows: [
          ...filterStages,
          { $sort: buildBookmarkSort(sort) },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              createdAt: 1,
              availability: 1,
              accessType: 1,
              numericPrice: 1,
              courseId: "$course._id",
              title: "$course.C_title",
              category: "$course.C_categories",
              educator: "$course.C_educator",
              description: "$course.C_description",
              price: "$course.C_price",
              enrolled: "$course.enrolled",
              courseCreatedAt: "$course.createdAt",
              courseUpdatedAt: "$course.updatedAt",
            },
          },
        ],
        total: [...filterStages, { $count: "value" }],
        // Deliberately outside filterStages. The dropdown lists every category
        // the user has saved, so filtering by one must not remove the others
        // from the list the user is filtering with.
        categories: [
          { $match: { "course.C_categories": { $nin: [null, ""] } } },
          { $group: { _id: "$course.C_categories" } },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ];
}

/**
 * The aggregate options. Collation is what keeps the title sorts behaving like
 * the localeCompare they replace.
 *
 * @param {object} filters
 * @returns {object}
 */
function bookmarkAggregateOptions(filters = {}) {
  const sort = filters.sort || "recent";

  if (sort !== "title-asc" && sort !== "title-desc") return {};

  return { collation: TITLE_COLLATION };
}

/**
 * Shapes one projected row into the response the wishlist reads.
 *
 * Runs over the page only — twelve rows by default — where serializeCourse ran
 * over every saved course to produce those same twelve.
 *
 * @param {object} row
 * @returns {object}
 */
function toSavedCourseRow(row = {}) {
  const available = row.availability === "available";

  if (!available) {
    return {
      bookmarkId: String(row._id),
      savedAt: row.createdAt || null,
      course: {
        id: null,
        title: MISSING_COURSE.title,
        category: MISSING_COURSE.category,
        educator: MISSING_COURSE.educator,
        description: MISSING_COURSE.description,
        price: null,
        numericPrice: 0,
        accessType: "unavailable",
        availability: "deleted",
        enrolled: 0,
      },
    };
  }

  const numericPrice = Number(row.numericPrice);

  return {
    bookmarkId: String(row._id),
    savedAt: row.createdAt || null,
    course: {
      id: String(row.courseId),
      title: row.title,
      category: row.category,
      educator: row.educator,
      description: row.description,
      price: row.price || "Free",
      numericPrice: Number.isFinite(numericPrice) ? numericPrice : 0,
      accessType: row.accessType,
      availability: "available",
      enrolled: Number(row.enrolled) || 0,
      createdAt: row.courseCreatedAt,
      updatedAt: row.courseUpdatedAt,
    },
  };
}

/**
 * Turns the single $facet document into the response body.
 *
 * @param {object} facet
 * @param {object} filters
 * @returns {{ data: object[], categories: string[], pagination: object }}
 */
function readBookmarkFacet(facet, filters = {}) {
  const rows = Array.isArray(facet?.rows) ? facet.rows : [];
  const totalItems = Number(facet?.total?.[0]?.value) || 0;
  const limit = filters.limit || DEFAULT_LIMIT;

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const page = Math.min(Math.max(1, filters.page || 1), totalPages);

  const categories = (Array.isArray(facet?.categories) ? facet.categories : [])
    .map((bucket) => bucket?._id)
    .filter(Boolean);

  return {
    data: rows.map(toSavedCourseRow),
    categories,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages,
    },
  };
}

/**
 * The page to retry with when the request asked past the end, or null.
 *
 * The old code clamped by slicing an array it already had. An aggregation has
 * skipped past the end before it knows the total.
 *
 * @param {object} filters
 * @param {number} totalItems
 * @returns {number|null}
 */
function clampedPage(filters = {}, totalItems = 0) {
  const limit = filters.limit || DEFAULT_LIMIT;
  const page = Math.max(1, filters.page || 1);

  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));

  return page > totalPages ? totalPages : null;
}

module.exports = {
  ALLOWED_ACCESS,
  ALLOWED_AVAILABILITY,
  ALLOWED_SORTS,
  COMPUTED_FIELDS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MISSING_COURSE,
  TITLE_COLLATION,
  bookmarkAggregateOptions,
  buildBookmarkPipeline,
  buildBookmarkSort,
  buildFilterStages,
  clampedPage,
  parsePositiveInteger,
  parseSavedCoursesQuery,
  readBookmarkFacet,
  toSavedCourseRow,
};
