import PropTypes from 'prop-types';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from './authContext';
import { normalizeRole } from './session';

/**
 * Wraps a route element so it is only rendered for a valid session.
 *
 * Declaring routes conditionally, as the app used to, is not a guard: when the
 * condition is false the route simply does not exist, React Router matches
 * nothing, and the visitor gets a blank page with the URL unchanged. Rendering
 * a <Navigate> instead sends them to the login screen and remembers where they
 * were going.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {string[]} [props.allowedRoles] lowercase role names; omit to allow any
 * @param {string} [props.redirectTo]
 */
export function ProtectedRoute({ children, allowedRoles, redirectTo = '/login' }) {
  const { isAuthenticated, role } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // `state.from` is what lets the login screen send the user back to the page
    // they originally asked for. `replace` keeps the guarded URL out of the
    // history stack, so Back does not bounce between it and /login.
    return <Navigate to={redirectTo} replace state={{ from: location }} />;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
    const allowed = allowedRoles.map(normalizeRole);

    if (!allowed.includes(role)) {
      // Signed in, but not for this page. Send them somewhere they can use
      // rather than to a login form they have already completed.
      return <Navigate to="/dashboard" replace />;
    }
  }

  return children;
}

ProtectedRoute.propTypes = {
  children: PropTypes.node,
  allowedRoles: PropTypes.arrayOf(PropTypes.string),
  redirectTo: PropTypes.string,
};

/**
 * The mirror image: keeps a signed-in user off the login and register screens,
 * returning them to wherever the guard originally interrupted them.
 */
export function PublicOnlyRoute({ children, redirectTo = '/dashboard' }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (isAuthenticated) {
    const intended = location.state?.from?.pathname;
    return <Navigate to={intended || redirectTo} replace />;
  }

  return children;
}

PublicOnlyRoute.propTypes = {
  children: PropTypes.node,
  redirectTo: PropTypes.string,
};
