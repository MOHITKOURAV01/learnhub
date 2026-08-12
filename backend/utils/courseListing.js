const FREE_PRICE_PATTERN = /^\s*(?:free|0(?:\.0+)?)\s*$/i;

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

  if (priceType === "free") {
    filter.C_price = {
      $regex: FREE_PRICE_PATTERN,
    };
  } else if (priceType === "paid") {
    filter.$and = [
      { C_price: { $exists: true } },
      { C_price: { $ne: "" } },
      { C_price: { $not: FREE_PRICE_PATTERN } },
    ];
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
