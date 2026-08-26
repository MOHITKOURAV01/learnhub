import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_STORAGE_KEY,
  THEMES,
  THEME_STORAGE_KEY,
  applyTheme,
  describeNextPreference,
  isThemePreference,
  nextPreference,
  readStoredPreference,
  resolveTheme,
  themeIcon,
  themeLabel,
  writeStoredPreference,
} from './theme.js';

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial));

  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    has: (key) => store.has(key),
  };
}

function createHostileStorage() {
  return {
    getItem() {
      throw new Error('access denied');
    },
    setItem() {
      throw new Error('access denied');
    },
    removeItem() {
      throw new Error('access denied');
    },
  };
}

// A DOM stub: enough of classList, dataset and style for applyTheme.
function createClassList() {
  const classes = new Set();

  return {
    classes,
    toggle(name, force) {
      if (force) classes.add(name);
      else classes.delete(name);
    },
    contains: (name) => classes.has(name),
  };
}

function createDocument({ withBody = true } = {}) {
  return {
    documentElement: {
      classList: createClassList(),
      dataset: {},
      style: {},
    },
    body: withBody ? { classList: createClassList() } : null,
  };
}

test('only the three known preferences are accepted', () => {
  assert.equal(isThemePreference('light'), true);
  assert.equal(isThemePreference('dark'), true);
  assert.equal(isThemePreference('system'), true);
  assert.equal(isThemePreference('midnight'), false);
  assert.equal(isThemePreference(true), false);
  assert.equal(isThemePreference(null), false);
});

test('the default preference follows the system', () => {
  assert.equal(readStoredPreference(createStorage()), THEMES.SYSTEM);
  assert.equal(readStoredPreference(null), THEMES.SYSTEM);
});

test('a stored preference is read back', () => {
  assert.equal(
    readStoredPreference(createStorage({ [THEME_STORAGE_KEY]: 'dark' })),
    THEMES.DARK,
  );
  assert.equal(
    readStoredPreference(createStorage({ [THEME_STORAGE_KEY]: 'light' })),
    THEMES.LIGHT,
  );
});

test('an unrecognised stored value falls back to system', () => {
  assert.equal(
    readStoredPreference(createStorage({ [THEME_STORAGE_KEY]: 'midnight' })),
    THEMES.SYSTEM,
  );
});

test("the old darkMode key is carried over rather than dropped", () => {
  // NavBar wrote a boolean and read it back as a string.
  assert.equal(
    readStoredPreference(createStorage({ [LEGACY_STORAGE_KEY]: 'true' })),
    THEMES.DARK,
  );
  assert.equal(
    readStoredPreference(createStorage({ [LEGACY_STORAGE_KEY]: 'false' })),
    THEMES.LIGHT,
  );
});

test('the new key wins over the legacy one', () => {
  const storage = createStorage({
    [THEME_STORAGE_KEY]: 'light',
    [LEGACY_STORAGE_KEY]: 'true',
  });

  assert.equal(readStoredPreference(storage), THEMES.LIGHT);
});

test('writing a preference retires the legacy key', () => {
  const storage = createStorage({ [LEGACY_STORAGE_KEY]: 'true' });

  writeStoredPreference(THEMES.DARK, storage);

  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'dark');
  assert.equal(storage.has(LEGACY_STORAGE_KEY), false);
});

test('an invalid preference is not written', () => {
  const storage = createStorage();

  writeStoredPreference('midnight', storage);

  assert.equal(storage.getItem(THEME_STORAGE_KEY), null);
});

test('a storage that throws does not take the page down', () => {
  const hostile = createHostileStorage();

  // Private mode, a disabled store, a hostile embedder.
  assert.equal(readStoredPreference(hostile), THEMES.SYSTEM);
  assert.doesNotThrow(() => writeStoredPreference(THEMES.DARK, hostile));
});

test('an explicit choice overrides the system in both directions', () => {
  assert.equal(resolveTheme(THEMES.DARK, false), THEMES.DARK);
  assert.equal(resolveTheme(THEMES.LIGHT, true), THEMES.LIGHT);
});

test('system follows prefers-color-scheme, which nothing consulted before', () => {
  assert.equal(resolveTheme(THEMES.SYSTEM, true), THEMES.DARK);
  assert.equal(resolveTheme(THEMES.SYSTEM, false), THEMES.LIGHT);
});

test('an unrecognised preference resolves like system rather than throwing', () => {
  assert.equal(resolveTheme('midnight', true), THEMES.DARK);
  assert.equal(resolveTheme(undefined, false), THEMES.LIGHT);
});

test('applying dark sets the class on both the root and the body', () => {
  const doc = createDocument();

  applyTheme(THEMES.DARK, doc);

  // <html> is what the pre-paint script can reach and what color-scheme sits on.
  assert.equal(doc.documentElement.classList.contains('dark-mode'), true);
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal(doc.documentElement.style.colorScheme, 'dark');
  // <body> is what every existing stylesheet is keyed on.
  assert.equal(doc.body.classList.contains('dark-mode'), true);
});

test('applying light removes the class from both', () => {
  const doc = createDocument();

  applyTheme(THEMES.DARK, doc);
  applyTheme(THEMES.LIGHT, doc);

  assert.equal(doc.documentElement.classList.contains('dark-mode'), false);
  assert.equal(doc.documentElement.dataset.theme, 'light');
  assert.equal(doc.documentElement.style.colorScheme, 'light');
  assert.equal(doc.body.classList.contains('dark-mode'), false);
});

test('applying works before <body> exists, which is the pre-paint case', () => {
  const doc = createDocument({ withBody: false });

  assert.doesNotThrow(() => applyTheme(THEMES.DARK, doc));
  assert.equal(doc.documentElement.classList.contains('dark-mode'), true);
});

test('applying with no document at all is a no-op', () => {
  assert.doesNotThrow(() => applyTheme(THEMES.DARK, null));
});

test('the toggle cycles light, dark, system and back', () => {
  assert.equal(nextPreference(THEMES.SYSTEM), THEMES.LIGHT);
  assert.equal(nextPreference(THEMES.LIGHT), THEMES.DARK);
  assert.equal(nextPreference(THEMES.DARK), THEMES.SYSTEM);
  assert.equal(nextPreference('midnight'), THEMES.LIGHT);
});

test('the toggle says what it will do next, not what is current', () => {
  assert.equal(
    describeNextPreference(THEMES.SYSTEM, THEMES.DARK),
    'Switch to light mode',
  );
  assert.equal(
    describeNextPreference(THEMES.LIGHT, THEMES.LIGHT),
    'Switch to dark mode',
  );
  assert.equal(
    describeNextPreference(THEMES.DARK, THEMES.DARK),
    'Follow system theme (currently dark)',
  );
});

test('the icon distinguishes an explicit choice from following the system', () => {
  assert.equal(themeIcon(THEMES.SYSTEM, THEMES.DARK), '🖥️');
  assert.equal(themeIcon(THEMES.DARK, THEMES.DARK), '🌙');
  assert.equal(themeIcon(THEMES.LIGHT, THEMES.LIGHT), '🌞');
});

test('the label names the preference, not the resolved theme', () => {
  assert.equal(themeLabel(THEMES.LIGHT), 'Light');
  assert.equal(themeLabel(THEMES.DARK), 'Dark');
  assert.equal(themeLabel(THEMES.SYSTEM), 'System');
  assert.equal(themeLabel('midnight'), 'System');
});
