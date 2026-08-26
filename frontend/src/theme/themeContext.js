import { createContext, useContext } from 'react';

import { THEMES } from '../lib/theme';

// Split from the provider so a fast-refresh boundary is not created by a file
// exporting both a component and a hook — the same split AuthProvider uses.

export const ThemeContext = createContext({
  preference: THEMES.SYSTEM,
  theme: THEMES.LIGHT,
  setPreference: () => {},
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}
