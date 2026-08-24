// Role names, in one place.
//
// `userModel` declares `type` with `lowercase: true` and an enum of
// ["student", "teacher", "admin"], and `validateRegistration` lowercases the
// value before that, so every account written since the #55 registration
// hardening stores its role lowercase. Four components still compared it
// against "Teacher", "Student" and "Admin":
//
//   switch (user.userData.type) { case "Teacher": ... }   // UserHome
//   {user.userData.type === 'Teacher' && ...}             // NavBar
//
// No case matched, so `UserHome` rendered nothing and the navbar showed no
// role-specific links. Nothing threw, which is why it read as a page that
// never finished loading.
//
// Everything that asks "what is this account" goes through here now, so a
// future change to how the value is stored is one edit rather than four.

export const ROLES = Object.freeze({
  STUDENT: 'student',
  TEACHER: 'teacher',
  ADMIN: 'admin',
});

const ROLE_LABELS = Object.freeze({
  [ROLES.STUDENT]: 'Student',
  [ROLES.TEACHER]: 'Teacher',
  [ROLES.ADMIN]: 'Admin',
});

/**
 * Reduces a role to the form the API stores.
 *
 * Documents written before #55 may still hold "Teacher", so this is a
 * comparison rule rather than a migration: both shapes normalise to the same
 * value and no data has to be rewritten.
 *
 * @param {unknown} role
 * @returns {string} a lowercase role, or '' when there isn't one
 */
export function normalizeRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

/**
 * Pulls the role out of a stored user object.
 *
 * The field is `type` on the API. Some call sites carry a `role` alias, so both
 * are accepted and `type` wins.
 *
 * @param {object|null|undefined} user
 * @returns {string}
 */
export function getUserRole(user) {
  if (!user || typeof user !== 'object') return '';

  return normalizeRole(user.type ?? user.role);
}

/**
 * @param {object|null|undefined} user
 * @param {string} role
 * @returns {boolean}
 */
export function isRole(user, role) {
  const actual = getUserRole(user);

  return Boolean(actual) && actual === normalizeRole(role);
}

/**
 * @param {object|null|undefined} user
 * @param {string[]} roles
 * @returns {boolean}
 */
export function hasAnyRole(user, roles) {
  if (!Array.isArray(roles) || roles.length === 0) return false;

  const actual = getUserRole(user);
  if (!actual) return false;

  return roles.map(normalizeRole).includes(actual);
}

export const isStudent = (user) => isRole(user, ROLES.STUDENT);
export const isTeacher = (user) => isRole(user, ROLES.TEACHER);
export const isAdmin = (user) => isRole(user, ROLES.ADMIN);

/**
 * The display form. Stored roles are lowercase, and "Signed in as student"
 * reads badly, so capitalisation for the UI is derived rather than stored.
 *
 * @param {unknown} role
 * @returns {string}
 */
export function roleLabel(role) {
  const normalized = normalizeRole(role);

  if (!normalized) return '';

  return ROLE_LABELS[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
