import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROLES,
  getUserRole,
  hasAnyRole,
  isAdmin,
  isRole,
  isStudent,
  isTeacher,
  normalizeRole,
  roleLabel,
} from './roles.js';

// The bug these guard against produced no error of any kind: `UserHome`
// switched on "Teacher" while the API stores "teacher", no case matched, and
// the dashboard rendered an empty box.

test('a stored lowercase role matches the role it names', () => {
  assert.equal(isTeacher({ type: 'teacher' }), true);
  assert.equal(isStudent({ type: 'student' }), true);
  assert.equal(isAdmin({ type: 'admin' }), true);
});

test('a capitalised role from an older document still matches', () => {
  // Accounts written before #55 added `lowercase: true` to the schema.
  assert.equal(isTeacher({ type: 'Teacher' }), true);
  assert.equal(isStudent({ type: 'STUDENT' }), true);
  assert.equal(isAdmin({ type: '  Admin  ' }), true);
});

test('roles do not match each other', () => {
  assert.equal(isTeacher({ type: 'student' }), false);
  assert.equal(isAdmin({ type: 'teacher' }), false);
});

test('a missing or malformed user has no role and matches nothing', () => {
  assert.equal(getUserRole(null), '');
  assert.equal(getUserRole(undefined), '');
  assert.equal(getUserRole({}), '');
  assert.equal(getUserRole('teacher'), '');
  assert.equal(getUserRole({ type: 42 }), '');

  assert.equal(isTeacher(null), false);
  assert.equal(isRole({}, 'student'), false);
});

test('an empty role never matches an empty expectation', () => {
  // Without the emptiness guard, normalizeRole('') === normalizeRole(undefined)
  // and a user with no role would pass every check.
  assert.equal(isRole({ type: '' }, ''), false);
  assert.equal(hasAnyRole({ type: '' }, ['']), false);
});

test('the role alias is read when type is absent', () => {
  assert.equal(getUserRole({ role: 'Admin' }), 'admin');
  // type wins when both are present.
  assert.equal(getUserRole({ type: 'student', role: 'admin' }), 'student');
});

test('hasAnyRole accepts any spelling in the allow list', () => {
  assert.equal(hasAnyRole({ type: 'teacher' }, ['Teacher', 'Admin']), true);
  assert.equal(hasAnyRole({ type: 'student' }, ['teacher', 'admin']), false);
  assert.equal(hasAnyRole({ type: 'teacher' }, []), false);
  assert.equal(hasAnyRole({ type: 'teacher' }, null), false);
});

test('normalizeRole trims and lowercases, and tolerates non-strings', () => {
  assert.equal(normalizeRole('  Teacher '), 'teacher');
  assert.equal(normalizeRole(undefined), '');
  assert.equal(normalizeRole(null), '');
  assert.equal(normalizeRole(7), '');
});

test('labels are derived for display rather than stored', () => {
  assert.equal(roleLabel('teacher'), 'Teacher');
  assert.equal(roleLabel('ADMIN'), 'Admin');
  assert.equal(roleLabel('moderator'), 'Moderator');
  assert.equal(roleLabel(''), '');
  assert.equal(roleLabel(undefined), '');
});

test('the constants are the values the API stores', () => {
  assert.deepEqual(Object.values(ROLES), ['student', 'teacher', 'admin']);
});
