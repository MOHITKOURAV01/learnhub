import { createContext, useContext } from 'react';

// Kept in a plain .js file with no component in it, so React Fast Refresh keeps
// working for the provider and the guard components that import it.

export const AuthContext = createContext({
  isAuthenticated: false,
  user: null,
  token: null,
  role: '',
  refresh: () => {},
  signOut: () => {},
});

/**
 * @returns {{
 *   isAuthenticated: boolean,
 *   user: object|null,
 *   token: string|null,
 *   role: string,
 *   refresh: () => void,
 *   signOut: () => void,
 * }}
 */
export function useAuth() {
  return useContext(AuthContext);
}
