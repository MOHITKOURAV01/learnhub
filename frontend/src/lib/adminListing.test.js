import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_SIZE,
  buildCourseParams,
  buildUserParams,
  describeAdminRange,
  describeRoleSummary,
  formatAdminDate,
  readAdminCourse,
  readAdminCourses,
  readRoleSummary,
  readUser,
  readUsers,
} from './adminListing.js';

test('the default user request asks for one page, not the collection', () => {
  assert.deepEqual(buildUserParams(), { page: 1, limit: PAGE_SIZE });
});

test('a user search is trimmed and only sent when it has content', () => {
  assert.equal(buildUserParams({ search: '  ann  ' }).search, 'ann');
  assert.equal(buildUserParams({ search: '   ' }).search, undefined);
});

test('only a known role is forwarded as a filter', () => {
  assert.equal(buildUserParams({ role: 'teacher' }).role, 'teacher');
  assert.equal(buildUserParams({ role: 'superuser' }).role, undefined);
  assert.equal(buildUserParams({ role: '' }).role, undefined);
});

test('only a known sort is forwarded, and the default stays implicit', () => {
  assert.equal(buildUserParams({ sort: 'name' }).sort, 'name');
  assert.equal(buildUserParams({ sort: 'newest' }).sort, undefined);
  assert.equal(buildUserParams({ sort: 'nonsense' }).sort, undefined);
});

test('a nonsense page falls back to the first', () => {
  assert.equal(buildUserParams({ page: -2 }).page, 1);
  assert.equal(buildUserParams({ page: 'x' }).page, 1);
  assert.equal(buildCourseParams({ page: 0 }).page, 1);
  assert.equal(buildCourseParams({ page: 5 }).page, 5);
});

test('the course price filter accepts only free or paid', () => {
  assert.equal(buildCourseParams({ priceType: 'free' }).priceType, 'free');
  assert.equal(buildCourseParams({ priceType: 'paid' }).priceType, 'paid');
  assert.equal(buildCourseParams({ priceType: 'cheap' }).priceType, undefined);
});

test('a user row is normalised and the role is lowercased', () => {
  const user = readUser({
    _id: 'u1',
    name: 'Ann',
    email: 'ann@x.com',
    type: 'Teacher',
    isVerified: true,
  });

  assert.deepEqual(
    { ...user, createdAt: undefined },
    {
      id: 'u1',
      name: 'Ann',
      email: 'ann@x.com',
      role: 'teacher',
      verified: true,
      createdAt: undefined,
    },
  );
});

test('a user row missing everything still renders', () => {
  const user = readUser({ _id: 'u1' });

  assert.equal(user.name, 'Unnamed account');
  assert.equal(user.email, '—');
  assert.equal(user.role, 'unknown');
  assert.equal(user.verified, false);
});

test('readUsers drops rows with no id and tolerates a bad payload', () => {
  assert.deepEqual(readUsers(null), []);
  assert.deepEqual(readUsers({ data: 'nope' }), []);
  assert.equal(readUsers({ data: [{ _id: 'a' }, {}, null] }).length, 1);
});

test('a course row carries a count and never a sections array', () => {
  const course = readAdminCourse({
    _id: 'c1',
    C_title: 'Intro',
    C_educator: 'Jane',
    sectionCount: 4,
    enrolled: 12,
  });

  assert.equal(course.sectionCount, 4);
  assert.equal(course.enrolled, 12);
  assert.equal(course.sections, undefined);
});

test('a missing sectionCount reads as zero rather than NaN or undefined', () => {
  // On main this was `Course.sections.length` — undefined for an object-shaped
  // field, a TypeError when absent.
  assert.equal(readAdminCourse({ _id: 'c1' }).sectionCount, 0);
  assert.equal(readAdminCourse({ _id: 'c1', sectionCount: 'four' }).sectionCount, 0);
  assert.equal(readAdminCourse({ _id: 'c1', enrolled: -5 }).enrolled, 0);
});

test('a course row fills in the blanks', () => {
  const course = readAdminCourse({ _id: 'c1' });

  assert.equal(course.title, 'Untitled course');
  assert.equal(course.educator, 'Unknown educator');
  assert.equal(course.category, 'Uncategorised');
  assert.equal(course.price, 'free');
});

test('readAdminCourses tolerates a bad payload', () => {
  assert.deepEqual(readAdminCourses(null), []);
  assert.deepEqual(readAdminCourses({ data: {} }), []);
  assert.equal(readAdminCourses({ data: [{ _id: 'c1' }] }).length, 1);
});

test('the role summary defaults to zeroes', () => {
  assert.deepEqual(readRoleSummary(null), {
    total: 0,
    student: 0,
    teacher: 0,
    admin: 0,
  });
  assert.deepEqual(
    readRoleSummary({ summary: { total: 20, student: 16, teacher: 4, admin: 0 } }),
    { total: 20, student: 16, teacher: 4, admin: 0 },
  );
});

test('the summary line names only the roles that exist', () => {
  assert.equal(
    describeRoleSummary({ total: 20, student: 16, teacher: 4, admin: 0 }),
    '20 accounts · 16 students · 4 educators',
  );
  assert.equal(
    describeRoleSummary({ total: 1, student: 1, teacher: 0, admin: 0 }),
    '1 account · 1 students',
  );
  assert.equal(
    describeRoleSummary({ total: 0, student: 0, teacher: 0, admin: 0 }),
    'No accounts yet',
  );
});

test('the range line describes the slice on screen', () => {
  assert.equal(
    describeAdminRange({ page: 2, limit: 20, totalItems: 45 }, 20, 'accounts'),
    'Showing 21–40 of 45 accounts',
  );
  assert.equal(
    describeAdminRange({ page: 3, limit: 20, totalItems: 45 }, 5, 'accounts'),
    'Showing 41–45 of 45 accounts',
  );
  assert.equal(
    describeAdminRange({ totalItems: 0 }, 0, 'courses'),
    'No courses to show',
  );
  assert.equal(describeAdminRange(null, 0), 'No rows to show');
});

test('a date is formatted, and an unusable one becomes a dash', () => {
  assert.ok(formatAdminDate('2026-03-04T09:30:00.000Z').length > 0);
  assert.equal(formatAdminDate(null), '—');
  assert.equal(formatAdminDate('not a date'), '—');
});
