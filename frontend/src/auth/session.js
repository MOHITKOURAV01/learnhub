// Session reading and writing, in one place.
//
// The app used to decide whether somebody was signed in with
// `if (JSON.parse(localStorage.getItem("user")))`, which is true for any
// truthy value and never looked at the token at all. Everything that reads or
// clears the session now goes through here so the rules are applied once.

import {
  TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
} from '../components/common/AxiosInstance';

// The storage keys are owned by AxiosInstance, whose 401 interceptor clears the
// same two entries. Importing them keeps a single source of truth instead of a
// second set of string literals that can drift apart.
export const TOKEN_KEY = TOKEN_STORAGE_KEY;
export const USER_KEY = USER_STORAGE_KEY;

// A little slack so a token that is about to expire is not treated as valid
// for a request that will land after it has.
const EXPIRY_LEEWAY_SECONDS = 30;

function safeAtob(value) {
  try {
    return atob(value);
  } catch {
    return null;
  }
}

/**
 * Decodes the payload of a JWT without verifying it.
 *
 * The signature can only be checked by the server, and it is the server that
 * enforces it. Reading the payload here is purely so the UI can avoid rendering
 * a signed-in shell around a token it already knows is expired.
 *
 * @param {unknown} token
 * @returns {object|null} the payload, or null if the token is unreadable
 */
export function decodeToken(token) {
  if (typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  // JWTs use base64url; atob wants plain base64.
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const json = safeAtob(padded);

  if (!json) return null;

  try {
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} token
 * @param {number} [nowMs] injectable clock, for tests
 * @returns {boolean} true when the token is readable and not past its exp
 */
export function isTokenValid(token, nowMs = Date.now()) {
  const payload = decodeToken(token);
  if (!payload) return false;

  // A token with no exp cannot be shown to be expired, so treat it as usable
  // and let the server have the final say.
  if (payload.exp === undefined || payload.exp === null) return true;

  if (typeof payload.exp !== 'number') return false;

  return payload.exp - EXPIRY_LEEWAY_SECONDS > nowMs / 1000;
}

function parseStoredUser(raw) {
  if (typeof raw !== 'string' || !raw) return null;

  try {
    const parsed = JSON.parse(raw);
    // `localStorage.setItem("user", "1")` parses to a number, which used to be
    // enough to render the signed-in shell. Only an object with an id counts.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed._id || parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reads the current session.
 *
 * @param {Storage} [storage]
 * @param {number} [nowMs]
 * @returns {{ isAuthenticated: boolean, user: object|null, token: string|null, role: string }}
 */
export function readSession(storage = window.localStorage, nowMs = Date.now()) {
  const token = storage.getItem(TOKEN_KEY);
  const user = parseStoredUser(storage.getItem(USER_KEY));

  if (!user || !isTokenValid(token, nowMs)) {
    return { isAuthenticated: false, user: null, token: null, role: '' };
  }

  return {
    isAuthenticated: true,
    user,
    token,
    role: normalizeRole(user.type),
  };
}

/** Roles are stored capitalised ("Teacher") but compared lowercase everywhere. */
export function normalizeRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

export function writeSession(token, user, storage = window.localStorage) {
  storage.setItem(TOKEN_KEY, token);
  storage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(storage = window.localStorage) {
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(USER_KEY);
}

/**
 * Drops a session that is no longer usable, so an expired token does not sit in
 * storage looking valid until the next login.
 *
 * @returns {boolean} true when something was cleared
 */
export function clearSessionIfStale(storage = window.localStorage, nowMs = Date.now()) {
  const token = storage.getItem(TOKEN_KEY);
  const rawUser = storage.getItem(USER_KEY);

  if (token === null && rawUser === null) return false;

  if (readSession(storage, nowMs).isAuthenticated) return false;

  clearSession(storage);
  return true;
}
