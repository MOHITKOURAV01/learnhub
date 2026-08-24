import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import {
  THEMES,
  applyTheme,
  nextPreference,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
} from '../lib/theme';
import { ThemeContext } from './themeContext';

// Owns the theme for the whole application, signed in or out (#97).
//
// The preference used to live in NavBar's local state, which meant it existed
// only on the pages NavBar rendered on — and NavBar returns null when there is
// no session, so the landing page, /login and /register could never be dark.

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readSystemPreference() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;

  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(() =>
    readStoredPreference(
      typeof window === 'undefined' ? null : window.localStorage,
    ),
  );
  const [prefersDark, setPrefersDark] = useState(readSystemPreference);

  // Follow the operating system while the preference is "system", so changing
  // it at sunset changes the page without a reload.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;

    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event) => setPrefersDark(event.matches);

    // addListener is the pre-2021 Safari spelling; still worth keeping.
    if (query.addEventListener) {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }

    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  const theme = useMemo(
    () => resolveTheme(preference, prefersDark),
    [preference, prefersDark],
  );

  // The inline script in index.html has already put the right class on <html>
  // before the first paint. This keeps it in step and adds the body class the
  // stylesheets are keyed on, which could not be set before <body> existed.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setPreference = useCallback((next) => {
    setPreferenceState(next);
    writeStoredPreference(
      next,
      typeof window === 'undefined' ? null : window.localStorage,
    );
  }, []);

  const toggleTheme = useCallback(() => {
    setPreferenceState((current) => {
      const next = nextPreference(current);

      writeStoredPreference(
        next,
        typeof window === 'undefined' ? null : window.localStorage,
      );

      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ preference, theme, setPreference, toggleTheme }),
    [preference, theme, setPreference, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

ThemeProvider.propTypes = {
  children: PropTypes.node,
};

ThemeProvider.defaultProps = {
  children: null,
};

export { THEMES };
