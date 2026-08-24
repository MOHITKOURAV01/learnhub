import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_SIZE,
  PROGRESS_STATES,
  buildEnrolledParams,
  courseHref,
  describeEnrolledRange,
  describeProgress,
  formatEnrolledDate,
  progressState,
  readProgress,
} from './enrolledCourses.js';

// -- query -------------------------------------------------------------------

test('the default query asks for the first page', () => {
  assert.deepEqual(buildEnrolledParams(), { page: 1, limit: PAGE_SIZE });
});

test('a nonsense page falls back to the first one', () => {
  assert.deepEqual(buildEnrolledParams({ page: 0 }), { page: 1, limit: PAGE_SIZE });
  assert.deepEqual(buildEnrolledParams({ page: -4 }), { page: 1, limit: PAGE_SIZE });
  assert.deepEqual(buildEnrolledParams({ page: 'two' }), { page: 1, limit: PAGE_SIZE });
  assert.deepEqual(buildEnrolledParams({ page: 3.7 }), { page: 3, limit: PAGE_SIZE });
});

// -- progress ----------------------------------------------------------------

test('the progress block is read as the server sends it', () => {
  assert.deepEqual(
    readProgress({ progress: { completed: 3, total: 8, percent: 38 } }),
    { completed: 3, total: 8, percent: 38 },
  );
});

test('percent is recomputed rather than trusted', () => {
  // A percent that disagrees with the counts would put a bar and its label in
  // contradiction on screen.
  assert.equal(
    readProgress({ progress: { completed: 1, total: 4, percent: 99 } }).percent,
    25,
  );
});

test('a row with no progress block falls back to the course length', () => {
  assert.deepEqual(readProgress({ courseLength: 5 }), {
    completed: 0,
    total: 5,
    percent: 0,
  });
});

test('a row with nothing at all is zeroed rather than NaN', () => {
  assert.deepEqual(readProgress({}), { completed: 0, total: 0, percent: 0 });
  assert.deepEqual(readProgress(undefined), { completed: 0, total: 0, percent: 0 });
});

test('completed can never exceed total', () => {
  // Older progress rows were written without a uniqueness guard, so the same
  // section can appear twice.
  assert.deepEqual(readProgress({ progress: { completed: 9, total: 4 } }), {
    completed: 4,
    total: 4,
    percent: 100,
  });
});

test('negative and non-numeric counts are treated as zero', () => {
  assert.deepEqual(readProgress({ progress: { completed: -2, total: 6 } }), {
    completed: 0,
    total: 6,
    percent: 0,
  });
  assert.deepEqual(readProgress({ progress: { completed: 'two', total: 'six' } }), {
    completed: 0,
    total: 0,
    percent: 0,
  });
});

test('a course with no sections is not silently complete', () => {
  const progress = readProgress({ progress: { completed: 0, total: 0 } });

  assert.equal(progress.percent, 0);
  assert.equal(progressState(progress), PROGRESS_STATES.NOT_STARTED);
  assert.equal(describeProgress(progress), 'No sections yet');
});

test('progress states', () => {
  assert.equal(progressState({ completed: 0, total: 4 }), PROGRESS_STATES.NOT_STARTED);
  assert.equal(progressState({ completed: 2, total: 4 }), PROGRESS_STATES.IN_PROGRESS);
  assert.equal(progressState({ completed: 4, total: 4 }), PROGRESS_STATES.COMPLETE);
});

test('the section count is worded for one section', () => {
  assert.equal(describeProgress({ completed: 0, total: 1 }), '0 of 1 section');
  assert.equal(describeProgress({ completed: 1, total: 2 }), '1 of 2 sections');
});

// -- links -------------------------------------------------------------------

test('a title with a slash does not add a path segment', () => {
  const href = courseHref({ _id: 'abc123', C_title: 'Node.js: HTTP/2 in practice' });

  assert.equal(href, '/courseSection/abc123/Node.js%3A%20HTTP%2F2%20in%20practice');
  assert.equal(href.split('/').length, 4);
});

test('a row with no title still produces a usable link', () => {
  assert.equal(courseHref({ _id: 'abc123' }), '/courseSection/abc123/Course');
});

// -- formatting --------------------------------------------------------------

test('a missing or unparseable enrolment date renders as nothing', () => {
  assert.equal(formatEnrolledDate(undefined), '');
  assert.equal(formatEnrolledDate(null), '');
  assert.equal(formatEnrolledDate('not a date'), '');
});

test('an ISO enrolment date is formatted', () => {
  assert.notEqual(formatEnrolledDate('2026-03-04T10:00:00.000Z'), '');
});

test('the range counts the whole collection, not the loaded page', () => {
  assert.equal(
    describeEnrolledRange({ page: 2, limit: 12, totalItems: 20 }, 8),
    'Showing 13–20 of 20 enrolled courses',
  );
  assert.equal(
    describeEnrolledRange({ page: 1, limit: 12, totalItems: 1 }, 1),
    'Showing 1 of 1 enrolled course',
  );
  assert.equal(describeEnrolledRange({ page: 1, limit: 12, totalItems: 0 }, 0), 'No enrolled courses');
});
