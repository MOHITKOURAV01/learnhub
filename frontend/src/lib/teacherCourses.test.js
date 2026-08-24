import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESCRIPTION_PREVIEW_LENGTH,
  PAGE_SIZE,
  buildTeacherParams,
  describeEnrolled,
  describeSections,
  describeSummary,
  describeTeacherRange,
  formatPublishedDate,
  previewDescription,
  readCourse,
  readCourses,
  readSummary,
} from './teacherCourses.js';

test('the default request asks for the first page', () => {
  assert.deepEqual(buildTeacherParams(), { page: 1, limit: PAGE_SIZE });
  assert.deepEqual(buildTeacherParams({}), { page: 1, limit: PAGE_SIZE });
});

test('a search term is trimmed and only sent when it has content', () => {
  assert.deepEqual(buildTeacherParams({ search: '  react  ' }), {
    page: 1,
    limit: PAGE_SIZE,
    search: 'react',
  });
  assert.equal(buildTeacherParams({ search: '   ' }).search, undefined);
});

test('only a known sort is forwarded, and the default is left implicit', () => {
  assert.equal(buildTeacherParams({ sort: 'title' }).sort, 'title');
  assert.equal(buildTeacherParams({ sort: 'newest' }).sort, undefined);
  assert.equal(buildTeacherParams({ sort: 'nonsense' }).sort, undefined);
});

test('a nonsense page number falls back to the first page', () => {
  assert.equal(buildTeacherParams({ page: -3 }).page, 1);
  assert.equal(buildTeacherParams({ page: 0 }).page, 1);
  assert.equal(buildTeacherParams({ page: 'x' }).page, 1);
  assert.equal(buildTeacherParams({ page: 4 }).page, 4);
});

test('a row is normalised and never reads sections off the document', () => {
  const course = readCourse({
    _id: 'abc',
    C_title: 'React',
    C_categories: 'IT & Software',
    C_description: 'A course',
    C_price: '49',
    enrolled: 12,
    sectionCount: 5,
  });

  assert.equal(course.id, 'abc');
  assert.equal(course.sectionCount, 5);
  assert.equal(course.enrolled, 12);
  assert.equal(course.sections, undefined);
});

test('a row missing every field still renders something', () => {
  const course = readCourse({ _id: 'abc' });

  assert.equal(course.title, 'Untitled course');
  assert.equal(course.category, 'Uncategorised');
  assert.equal(course.description, '');
  assert.equal(course.price, 'free');
  assert.equal(course.sectionCount, 0);
  assert.equal(course.enrolled, 0);
});

test('a non-numeric count reads as zero, not NaN', () => {
  assert.equal(readCourse({ _id: 'a', sectionCount: undefined }).sectionCount, 0);
  assert.equal(readCourse({ _id: 'a', enrolled: 'many' }).enrolled, 0);
  assert.equal(readCourse({ _id: 'a', enrolled: -2 }).enrolled, 0);
});

test('readCourses drops rows with no id and tolerates a bad payload', () => {
  assert.deepEqual(readCourses(null), []);
  assert.deepEqual(readCourses({ data: 'nope' }), []);
  assert.equal(readCourses({ data: [{ _id: 'a' }, {}, null] }).length, 1);
});

test('the summary defaults to zeroes rather than undefined', () => {
  assert.deepEqual(readSummary(null), { courses: 0, learners: 0 });
  assert.deepEqual(readSummary({}), { courses: 0, learners: 0 });
  assert.deepEqual(readSummary({ summary: { courses: 3, learners: 40 } }), {
    courses: 3,
    learners: 40,
  });
});

test('a short description is never truncated', () => {
  const { text, truncated } = previewDescription('Learn the fundamentals.');

  assert.equal(text, 'Learn the fundamentals.');
  assert.equal(truncated, false);
});

test('a long description is cut on a word boundary, not at ten characters', () => {
  const long = 'Learn the fundamentals of structuring and styling web pages '.repeat(5);
  const { text, truncated } = previewDescription(long);

  assert.equal(truncated, true);
  assert.ok(text.length <= DESCRIPTION_PREVIEW_LENGTH + 1);
  assert.ok(text.endsWith('…'));
  // The old preview was `slice(0, 10)` — "Learn the ".
  assert.ok(text.length > 20);
  assert.equal(text.includes('  '), false);
});

test('an expanded description is returned whole', () => {
  const long = 'x'.repeat(400);

  assert.deepEqual(previewDescription(long, true), {
    text: long,
    truncated: false,
  });
});

test('previewDescription tolerates a missing description', () => {
  assert.deepEqual(previewDescription(undefined), { text: '', truncated: false });
  assert.deepEqual(previewDescription(null), { text: '', truncated: false });
});

test('counts are described in words, singular and plural', () => {
  assert.equal(describeSections(0), 'No sections yet');
  assert.equal(describeSections(1), '1 section');
  assert.equal(describeSections(4), '4 sections');
  assert.equal(describeEnrolled(0), 'No learners yet');
  assert.equal(describeEnrolled(1), '1 learner');
  assert.equal(describeEnrolled(9), '9 learners');
});

test('the totals line reads as a sentence', () => {
  assert.equal(
    describeSummary({ courses: 3, learners: 40 }),
    '3 published courses · 40 learners',
  );
  assert.equal(
    describeSummary({ courses: 1, learners: 1 }),
    '1 published course · 1 learner',
  );
  assert.equal(
    describeSummary({ courses: 0, learners: 0 }),
    'You have not published a course yet',
  );
});

test('a publish date is formatted, and an unusable one is dropped', () => {
  assert.ok(formatPublishedDate('2026-03-04T09:30:00.000Z').length > 0);
  assert.equal(formatPublishedDate(null), '');
  assert.equal(formatPublishedDate('not a date'), '');
});

test('the range line describes the slice on screen', () => {
  assert.equal(
    describeTeacherRange({ page: 2, limit: 12, totalItems: 30 }, 12),
    'Showing 13–24 of 30 courses',
  );
  assert.equal(
    describeTeacherRange({ page: 3, limit: 12, totalItems: 30 }, 6),
    'Showing 25–30 of 30 courses',
  );
  assert.equal(describeTeacherRange({ totalItems: 0 }, 0), 'No courses to show');
  assert.equal(describeTeacherRange(null, 0), 'No courses to show');
});
