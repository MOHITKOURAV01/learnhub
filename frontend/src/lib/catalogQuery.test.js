import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_SIZE,
  buildCatalogParams,
  clampPage,
  describeRange,
  isPaidCourse,
  readPagination,
} from './catalogQuery.js';

// -- query building ----------------------------------------------------------

test('the default query asks for the first page and nothing else', () => {
  assert.deepEqual(buildCatalogParams(), { page: 1, limit: PAGE_SIZE });
});

test('empty filters are left out rather than sent as empty strings', () => {
  assert.deepEqual(
    buildCatalogParams({ search: '   ', priceType: '', sort: 'newest' }),
    { page: 1, limit: PAGE_SIZE },
  );
});

test('search is trimmed and passed through', () => {
  assert.equal(buildCatalogParams({ search: '  react  ' }).search, 'react');
});

test('only the two price filters the server knows about are sent', () => {
  assert.equal(buildCatalogParams({ priceType: 'Free' }).priceType, 'free');
  assert.equal(buildCatalogParams({ priceType: 'PAID' }).priceType, 'paid');
  assert.equal(buildCatalogParams({ priceType: 'cheap' }).priceType, undefined);
});

test('an unknown sort falls back to the server default', () => {
  assert.equal(buildCatalogParams({ sort: 'rating' }).sort, undefined);
  assert.equal(buildCatalogParams({ sort: 'popular' }).sort, 'popular');
});

test('a page below one is not sent', () => {
  assert.equal(buildCatalogParams({ page: 0 }).page, 1);
  assert.equal(buildCatalogParams({ page: -4 }).page, 1);
  assert.equal(buildCatalogParams({ page: 2.7 }).page, 2);
});

// -- free vs paid ------------------------------------------------------------

test('free is decided the same way the server decides it', () => {
  // The rule lives in lib/coursePricing now and is re-exported from here.
  // coursePricing.test.js holds the full table; these are the cases this
  // module's own callers care about.
  assert.equal(isPaidCourse({ C_price: 'Free for the first 100' }), true);
  assert.equal(isPaidCourse({ C_price: 'free' }), false);
  assert.equal(isPaidCourse({ C_price: 'Free' }), false);
  assert.equal(isPaidCourse({ C_price: '0' }), false);
  assert.equal(isPaidCourse({ C_price: '0.00' }), false);
  assert.equal(isPaidCourse({ C_price: '499' }), true);
  assert.equal(isPaidCourse({}), false);
});

test('a blank price is free, which is a change (#114)', () => {
  // This used to assert `true`. It was wrong, and inconsistent with the two
  // lines above it: an absent price returned early as free while a blank
  // string fell through to the pattern and came out paid. The card rendered
  // "ACCESS:" followed by nothing and opened a payment form for a course the
  // server records as `amount: "free"` and never charges for.
  assert.equal(isPaidCourse({ C_price: '' }), false);
  assert.equal(isPaidCourse({ C_price: '   ' }), false);
  assert.equal(isPaidCourse({ C_price: null }), false);
  assert.equal(isPaidCourse({ C_price: undefined }), false);
});

// -- reading the response ----------------------------------------------------

test('the pagination block is read as sent', () => {
  const pagination = readPagination({
    pagination: {
      page: 2,
      limit: 12,
      totalItems: 57,
      totalPages: 5,
      hasNextPage: true,
      hasPreviousPage: true,
    },
  });

  assert.deepEqual(pagination, {
    page: 2,
    limit: 12,
    totalItems: 57,
    totalPages: 5,
    hasNextPage: true,
    hasPreviousPage: true,
  });
});

test('a response with no pagination block does not break the grid', () => {
  const pagination = readPagination({ data: [1, 2, 3] }, 3);

  assert.equal(pagination.page, 1);
  assert.equal(pagination.totalItems, 3);
  assert.equal(pagination.totalPages, 1);
  assert.equal(pagination.hasNextPage, false);
});

test('totalPages and the has-page flags are derived when missing', () => {
  const pagination = readPagination({
    pagination: { page: 2, limit: 10, totalItems: 25 },
  });

  assert.equal(pagination.totalPages, 3);
  assert.equal(pagination.hasNextPage, true);
  assert.equal(pagination.hasPreviousPage, true);
});

test('an empty catalogue reports zero pages, not one', () => {
  const pagination = readPagination({
    pagination: { page: 1, limit: 12, totalItems: 0 },
  });

  assert.equal(pagination.totalPages, 0);
  assert.equal(pagination.hasNextPage, false);
  assert.equal(pagination.hasPreviousPage, false);
});

// -- page clamping -----------------------------------------------------------

test('a page past the end is pulled back to the last one', () => {
  // Tightening a filter, or a course being deleted, can leave the client on a
  // page the server no longer has.
  assert.equal(clampPage(9, 3), 3);
  assert.equal(clampPage(2, 3), 2);
});

test('an empty result set clamps to page one', () => {
  assert.equal(clampPage(4, 0), 1);
});

// -- the counter -------------------------------------------------------------

test('the counter describes the window, not the loaded array', () => {
  // It used to read visibleCourses.length and so maxed out at 12.
  assert.equal(
    describeRange({ page: 2, limit: 12, totalItems: 57 }, 12),
    'Showing 13–24 of 57 courses',
  );
});

test('the last page reports the real end, not page * limit', () => {
  assert.equal(
    describeRange({ page: 5, limit: 12, totalItems: 57 }, 9),
    'Showing 49–57 of 57 courses',
  );
});

test('a single result reads as one, not as a range', () => {
  assert.equal(
    describeRange({ page: 1, limit: 12, totalItems: 1 }, 1),
    'Showing 1 of 1 course',
  );
});

test('an empty catalogue says so', () => {
  assert.equal(describeRange({ page: 1, limit: 12, totalItems: 0 }, 0), 'No courses found');
});
