import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import { AuthContext } from './authContext';
import { clearSession, clearSessionIfStale, readSession } from './session';

/**
 * Holds the current session and keeps it in step with localStorage.
 *
 * The old App component read storage once on mount and never looked again, so
 * signing out in one tab left the other tab rendering a signed-in shell.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    clearSessionIfStale();
    return readSession();
  });

  const refresh = useCallback(() => {
    clearSessionIfStale();
    setSession(readSession());
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setSession(readSession());
  }, []);

  useEffect(() => {
    // Fires when another tab writes to localStorage.
    const handleStorage = (event) => {
      if (event.key === null || event.key === 'token' || event.key === 'user') {
        refresh();
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [refresh]);

  useEffect(() => {
    if (!session.isAuthenticated) return undefined;

    // A token can expire while the tab is simply left open. Re-checking on a
    // slow interval turns that into a redirect at the next navigation instead
    // of a wall of failed requests.
    const interval = setInterval(refresh, 60 * 1000);
    return () => clearInterval(interval);
  }, [session.isAuthenticated, refresh]);

  const value = useMemo(
    () => ({ ...session, refresh, signOut }),
    [session, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

AuthProvider.propTypes = {
  children: PropTypes.node,
};
