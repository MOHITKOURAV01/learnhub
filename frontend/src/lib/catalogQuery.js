// The catalogue used to call GET /api/user/getallcourses with no query at all
// and filter the result in the browser. normalizePagination on the server
// defaults to a limit of 12, so the page held 12 courses and the search box
// searched those 12. Course 13 was unreachable.
//
// Everything here is the pure half of talking to that endpoint: it builds the
// query the server already understands, and reads the pagination block it
// already returns. Kept free of React so it can be tested on its own.

export const PAGE_SIZE = 12;

// Mirrors FREE_PRICE_PATTERN in backend/utils/courseListing.js. The old client
// test was `/\d/.test(course.C_price)`, which called a course priced
// "Free for the first 100" paid while the server called it free, so the two
// halves of the same filter disagreed.
const FREE_PRICE_PATTERN = /^\s*(?:free|0(?:\.0+)?)\s*$/i;

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'popular', label: 'Most learners' },
  { value: 'title', label: 'Title A–Z' },
];

const SORT_VALUES = new Set(SORT_OPTIONS.map((option) => option.value));

/**
 * @param {object} course
 * @returns {boolean} whether the course costs money, by the server's rule
 */
export const isPaidCourse = (course) => {
  const price = course?.C_price;

  if (price === undefined || price === null) return false;

  return !FREE_PRICE_PATTERN.test(String(price));
};

/**
 * Turns the toolbar state into the query the API accepts.
 *
 * Empty values are left out rather than sent as `""`, so the request URL says
 * what it is actually asking for.
 *
 * @param {object} state
 * @param {string} [state.search]
 * @param {string} [state.priceType] "", "free" or "paid"
 * @param {string} [state.sort]
 * @param {number} [state.page]
 * @param {number} [state.limit]
 * @returns {object} params for axios
 */
export function buildCatalogParams({
  search = '',
  priceType = '',
  sort = 'newest',
  page = 1,
  limit = PAGE_SIZE,
} = {}) {
  const params = {
    page: Math.max(1, Math.floor(page) || 1),
    limit: Math.max(1, Math.floor(limit) || PAGE_SIZE),
  };

  const trimmedSearch = String(search).trim();
  if (trimmedSearch) {
    params.search = trimmedSearch;
  }

  const normalizedPrice = String(priceType).trim().toLowerCase();
  if (normalizedPrice === 'free' || normalizedPrice === 'paid') {
    params.priceType = normalizedPrice;
  }

  const normalizedSort = String(sort).trim().toLowerCase();
  if (SORT_VALUES.has(normalizedSort) && normalizedSort !== 'newest') {
    params.sort = normalizedSort;
  }

  return params;
}

/**
 * Reads the pagination block, filling in what an older response may not carry.
 *
 * @param {object} payload the response body
 * @param {number} fallbackCount how many rows came back, used when the block
 *   is missing entirely
 * @returns {{ page: number, limit: number, totalItems: number, totalPages: number, hasNextPage: boolean, hasPreviousPage: boolean }}
 */
export function readPagination(payload, fallbackCount = 0) {
  const block = payload?.pagination;

  if (!block || typeof block !== 'object') {
    return {
      page: 1,
      limit: PAGE_SIZE,
      totalItems: fallbackCount,
      totalPages: fallbackCount > 0 ? 1 : 0,
      hasNextPage: false,
      hasPreviousPage: false,
    };
  }

  const page = Number(block.page) || 1;
  const limit = Number(block.limit) || PAGE_SIZE;
  const totalItems = Number(block.totalItems) || 0;
  const totalPages =
    Number(block.totalPages) || (totalItems === 0 ? 0 : Math.ceil(totalItems / limit));

  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage:
      typeof block.hasNextPage === 'boolean' ? block.hasNextPage : page < totalPages,
    hasPreviousPage:
      typeof block.hasPreviousPage === 'boolean'
        ? block.hasPreviousPage
        : page > 1 && totalPages > 0,
  };
}

/**
 * Keeps the requested page inside the range that exists.
 *
 * Deleting the only course on the last page, or tightening a filter, can leave
 * the client asking for a page the server no longer has; without this the grid
 * renders empty and looks broken.
 *
 * @param {number} page
 * @param {number} totalPages
 * @returns {number}
 */
export function clampPage(page, totalPages) {
  const requested = Math.max(1, Math.floor(page) || 1);

  if (!totalPages || totalPages < 1) return 1;

  return Math.min(requested, totalPages);
}

/**
 * Builds the page numbers a pager should render, with `'gap'` standing in for
 * the stretches it does not show. A course site accumulates pages, and a strip
 * of forty numbers is not a control.
 *
 * The first, last and current pages are always present, so no page is ever
 * more than two clicks away.
 *
 * @param {number} page
 * @param {number} totalPages
 * @returns {Array<number|'gap'>}
 */
export function buildPageWindow(page, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, page]);

  if (page - 1 > 1) pages.add(page - 1);
  if (page + 1 < totalPages) pages.add(page + 1);

  const ordered = [...pages].sort((left, right) => left - right);
  const withGaps = [];

  ordered.forEach((value, index) => {
    if (index > 0 && value - ordered[index - 1] > 1) {
      withGaps.push('gap');
    }

    withGaps.push(value);
  });

  return withGaps;
}

/**
 * "Showing 13–24 of 57 courses" — the counter used to read off the loaded
 * array and so could never exceed 12.
 *
 * @param {object} pagination
 * @param {number} shown how many cards are actually rendered
 * @returns {string}
 */
export function describeRange(pagination, shown) {
  const { page, limit, totalItems } = pagination;

  if (!totalItems) return 'No courses found';

  const first = (page - 1) * limit + 1;
  const last = Math.min(first + Math.max(shown, 0) - 1, totalItems);
  const noun = totalItems === 1 ? 'course' : 'courses';

  if (first === last) {
    return `Showing ${first} of ${totalItems} ${noun}`;
  }

  return `Showing ${first}–${last} of ${totalItems} ${noun}`;
}
