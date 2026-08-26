// Theme preference: reading it, resolving it, applying it.
//
// The only thing that ever added `body.dark-mode` was NavBar, and NavBar
// returns null when there is no session:
//
//   if (!user?.userData) { return null }
//
// So the landing page, /login, /register, /privacy, /terms and the 404 had no
// code path that could put the class on the body, whatever the stored
// preference said. The class was also applied inside a useEffect — after the
// first paint — so every full load of a signed-in page flashed white (#97).
//
// The stylesheet itself is fine: App.css resolves colour through custom
// properties in 118 places, and `body.dark-mode` redefines eleven of them. The
// problem was entirely in when and where that class was applied.

export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
};

export const THEME_STORAGE_KEY = 'theme';

// The key NavBar used. Read once, to carry an existing preference over, and
// then removed.
export const LEGACY_STORAGE_KEY = 'darkMode';

// Applied to <html> by the pre-paint script in index.html, and kept in step by
// the provider. `body.dark-mode` is what the stylesheets are keyed on and is
// set alongside it — <body> does not exist yet when the inline script runs.
export const ROOT_DARK_CLASS = 'dark-mode';
export const BODY_DARK_CLASS = 'dark-mode';

const PREFERENCES = new Set(Object.values(THEMES));

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isThemePreference(value) {
  return typeof value === 'string' && PREFERENCES.has(value);
}

/**
 * Reads the stored preference, migrating the old boolean key if it is the only
 * thing present.
 *
 * The old key was written as a boolean and read back as a string
 * (`localStorage.setItem('darkMode', newMode)` against
 * `getItem('darkMode') === 'true'`), which worked by coercion. It is read once
 * here and translated into an explicit light/dark choice.
 *
 * @param {Storage} [storage]
 * @returns {string} one of THEMES
 */
export function readStoredPreference(storage) {
  if (!storage) return THEMES.SYSTEM;

  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);

    if (isThemePreference(stored)) return stored;

    const legacy = storage.getItem(LEGACY_STORAGE_KEY);

    if (legacy === 'true') return THEMES.DARK;
    if (legacy === 'false') return THEMES.LIGHT;
  } catch {
    // Private mode, a disabled store, a hostile embedder. The default is not
    // worth throwing over.
  }

  return THEMES.SYSTEM;
}

/**
 * @param {string} preference
 * @param {Storage} [storage]
 */
export function writeStoredPreference(preference, storage) {
  if (!storage || !isThemePreference(preference)) return;

  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
    // The migration only needs to happen once.
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // As above: a preference that cannot be saved is not an error worth
    // surfacing, it just does not persist.
  }
}

/**
 * Turns a preference into the theme actually in force.
 *
 * @param {string} preference
 * @param {boolean} prefersDark the value of the prefers-color-scheme query
 * @returns {'light'|'dark'}
 */
export function resolveTheme(preference, prefersDark) {
  if (preference === THEMES.DARK) return THEMES.DARK;
  if (preference === THEMES.LIGHT) return THEMES.LIGHT;

  // SYSTEM, and anything unrecognised, follows the operating system — which
  // was consulted nowhere in the application before this.
  return prefersDark ? THEMES.DARK : THEMES.LIGHT;
}

/**
 * Writes the resolved theme onto the document.
 *
 * Both places matter. `<html>` is what the pre-paint script can reach and what
 * `color-scheme` has to sit on for native controls and scrollbars to follow;
 * `<body>` is what every existing stylesheet is keyed on.
 *
 * @param {'light'|'dark'} theme
 * @param {Document} [doc]
 */
export function applyTheme(theme, doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return;

  const dark = theme === THEMES.DARK;
  const root = doc.documentElement;

  if (root) {
    root.classList.toggle(ROOT_DARK_CLASS, dark);
    root.dataset.theme = dark ? THEMES.DARK : THEMES.LIGHT;
    root.style.colorScheme = dark ? 'dark' : 'light';
  }

  // Null during the pre-paint window; the provider sets it on mount.
  if (doc.body) {
    doc.body.classList.toggle(BODY_DARK_CLASS, dark);
  }
}

/**
 * The order the toggle cycles through: whatever you are seeing, then its
 * opposite, then back to following the system.
 *
 * @param {string} preference
 * @returns {string}
 */
export function nextPreference(preference) {
  switch (preference) {
    case THEMES.LIGHT:
      return THEMES.DARK;
    case THEMES.DARK:
      return THEMES.SYSTEM;
    default:
      return THEMES.LIGHT;
  }
}

/**
 * @param {string} preference
 * @param {'light'|'dark'} resolved
 * @returns {string} what the toggle should say it will do next
 */
export function describeNextPreference(preference, resolved) {
  switch (nextPreference(preference)) {
    case THEMES.LIGHT:
      return 'Switch to light mode';
    case THEMES.DARK:
      return 'Switch to dark mode';
    default:
      return `Follow system theme (currently ${resolved})`;
  }
}

/**
 * @param {string} preference
 * @param {'light'|'dark'} resolved
 * @returns {string}
 */
export function themeIcon(preference, resolved) {
  if (preference === THEMES.SYSTEM) return '🖥️';

  return resolved === THEMES.DARK ? '🌙' : '🌞';
}

/**
 * @param {string} preference
 * @returns {string}
 */
export function themeLabel(preference) {
  switch (preference) {
    case THEMES.LIGHT:
      return 'Light';
    case THEMES.DARK:
      return 'Dark';
    default:
      return 'System';
  }
}
