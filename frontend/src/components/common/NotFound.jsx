import { Link } from 'react-router-dom';
import { Container } from 'react-bootstrap';

import { useAuth } from '../../auth/authContext';
import PublicNavBar from './PublicNavBar';

/**
 * Catch-all screen. Any unmatched URL used to render an empty page, which is
 * indistinguishable from the app having crashed.
 */
const NotFound = () => {
  const { isAuthenticated } = useAuth();

  return (
    <>
      {!isAuthenticated && <PublicNavBar />}
      <Container
        className="my-5 text-center"
        style={{ maxWidth: '640px' }}
      >
        <h1 style={{ fontSize: '4rem', marginBottom: '0.5rem' }}>404</h1>
        <h2 className="mb-3">This page does not exist</h2>
        <p className="mb-4">
          The link may be out of date, or the page may have been moved.
        </p>
        <Link
          to={isAuthenticated ? '/dashboard' : '/'}
          className="btn btn-primary"
        >
          {isAuthenticated ? 'Back to dashboard' : 'Back to home'}
        </Link>
      </Container>
    </>
  );
};

export default NotFound;
