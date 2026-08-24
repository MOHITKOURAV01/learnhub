import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SUMMARY_IDS,
  buildSummaryParams,
  collectCourseIds,
  normalizeSummary,
  readSummaryMap,
} from './ratingSummaries.js';

test('ids are collected from the rows in order', () => {
  assert.deepEqual(collectCourseIds([{ _id: 'a' }, { _id: 'b' }]), ['a', 'b']);
});

test('a repeated course is asked about once', () => {
  assert.deepEqual(collectCourseIds([{ _id: 'a' }, { _id: 'a' }]), ['a']);
});

test('rows with no id are skipped', () => {
  assert.deepEqual(collectCourseIds([{}, { _id: '' }, { _id: 'a' }, null]), ['a']);
});

test('nothing at all yields no ids and no request', () => {
  assert.deepEqual(collectCourseIds(undefined), []);
  assert.deepEqual(collectCourseIds([]), []);
  assert.equal(buildSummaryParams([]), null);
  assert.equal(buildSummaryParams(undefined), null);
});

test('the id list is capped to what the endpoint accepts', () => {
  const rows = Array.from({ length: MAX_SUMMARY_IDS + 10 }, (_, index) => ({
    _id: `course-${index}`,
  }));

  assert.equal(collectCourseIds(rows).length, MAX_SUMMARY_IDS);
});

test('the query is a comma separated list', () => {
  assert.deepEqual(buildSummaryParams(['a', 'b']), { courseIds: 'a,b' });
});

test('a malformed summary reads as zero rather than NaN', () => {
  assert.deepEqual(normalizeSummary({ averageRating: 'four', totalReviews: null }), {
    averageRating: 0,
    totalReviews: 0,
  });
  assert.deepEqual(normalizeSummary(undefined), { averageRating: 0, totalReviews: 0 });
  assert.deepEqual(normalizeSummary({ averageRating: -3, totalReviews: -1 }), {
    averageRating: 0,
    totalReviews: 0,
  });
});

test('a real summary survives normalisation intact', () => {
  assert.deepEqual(normalizeSummary({ averageRating: 4.5, totalReviews: 2 }), {
    averageRating: 4.5,
    totalReviews: 2,
  });
});

test('the response block becomes a map keyed by course id', () => {
  const map = readSummaryMap({
    data: {
      a: { averageRating: 4.5, totalReviews: 2 },
      b: { averageRating: 0, totalReviews: 0 },
    },
  });

  assert.equal(map.get('a').averageRating, 4.5);
  assert.equal(map.get('b').totalReviews, 0);
  assert.equal(map.size, 2);
});

test('a missing or malformed response block is an empty map, not a crash', () => {
  assert.equal(readSummaryMap(undefined).size, 0);
  assert.equal(readSummaryMap({}).size, 0);
  assert.equal(readSummaryMap({ data: null }).size, 0);
  assert.equal(readSummaryMap({ data: 'nope' }).size, 0);
});
