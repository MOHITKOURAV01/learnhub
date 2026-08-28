// The rule itself lives in utils/coursePricing, which is the single answer
// to "does this course cost money" that checkout, the wishlist and the
// browser now share (#114). Re-exported from here because this module is
// where several call sites already import it from.
const {
  FREE_PRICE_PATTERN,
  freePriceFilterClauses,
  paidPriceFilterClauses,
} = require("./coursePricing");

function firstQueryValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeText(value, maxLength = 120) {
  const raw = firstQueryValue(value);

  if (raw === undefined || raw === null) {
    return "";
  }

  return String(raw).trim().slice(0, maxLength);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCaseInsensitiveExactRegex(value) {
  return new RegExp(`^${escapeRegex(value)}$`, "i");
}

function buildCourseFilter(query = {}) {
  const filter = {};

  const search = normalizeText(query.search, 120);
  if (search) {
    const searchRegex = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { C_title: { $regex: searchRegex } },
      { C_description: { $regex: searchRegex } },
    ];
  }

  const category = normalizeText(query.category, 80);
  if (category) {
    filter.C_categories = {
      $regex: buildCaseInsensitiveExactRegex(category),
    };
  }

  const educator = normalizeText(query.educator, 100);
  if (educator) {
    filter.C_educator = {
      $regex: buildCaseInsensitiveExactRegex(educator),
    };
  }

  const priceType = normalizeText(query.priceType, 20).toLowerCase();

  // A blank or absent price is free, and a regex cannot match a field that
  // does not exist, so neither side of this is a single $regex any more. The
  // clauses come from coursePricing so the filter and the predicate cannot
  // drift: filtering to Free has to return exactly the courses whose cards
  // say Free.
  if (priceType === "free") {
    // $or, not a $regex on C_price, so a search term's $or is not clobbered.
    filter.$and = [{ $or: freePriceFilterClauses() }];
  } else if (priceType === "paid") {
    filter.$and = paidPriceFilterClauses();
  }

  return filter;
}

function buildCourseSort(query = {}) {
  const sort = normalizeText(query.sort, 30).toLowerCase();

  switch (sort) {
    case "title":
      return { C_title: 1, _id: 1 };

    case "enrollment":
    case "enrolled":
    case "popular":
      return { enrolled: -1, _id: 1 };

    case "newest":
    default:
      return { createdAt: -1, _id: -1 };
  }
}

module.exports = {
  FREE_PRICE_PATTERN,
  buildCaseInsensitiveExactRegex,
  buildCourseFilter,
  buildCourseSort,
  escapeRegex,
  normalizeText,
};
