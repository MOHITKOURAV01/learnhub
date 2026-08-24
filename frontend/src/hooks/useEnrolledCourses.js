import { useCallback, useEffect, useRef, useState } from 'react';

import axiosInstance from '../components/common/AxiosInstance';
import { clampPage, readPagination } from '../lib/catalogQuery';
import { PAGE_SIZE, buildEnrolledParams } from '../lib/enrolledCourses';

// Owns the request for the student "My courses" table.
//
// The table used to call the endpoint once, on mount, with no query, and keep
// whatever came back. The server pages at twelve, so enrolment thirteen was
// unreachable and the pagination block was thrown away.

const EMPTY_PAGINATION = {
  page: 1,
  limit: PAGE_SIZE,
  totalItems: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

export default function useEnrolledCourses() {
  const [courses, setCourses] = useState([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // A slow request for page one landing after a fast one for page two would
  // put the wrong rows on screen. Every request takes a ticket and only the
  // newest one is allowed to write state.
  const requestVersion = useRef(0);

  const load = useCallback(async (requestedPage) => {
    const version = ++requestVersion.current;

    setLoading(true);
    setError('');

    try {
      const res = await axiosInstance.get('/api/user/getallcoursesuser', {
        params: buildEnrolledParams({ page: requestedPage }),
      });

      if (version !== requestVersion.current) return;

      if (!res.data?.success) {
        setError(res.data?.message || 'Your enrolled courses could not be loaded.');
        setCourses([]);
        setPagination(EMPTY_PAGINATION);
        return;
      }

      const rows = Array.isArray(res.data.data) ? res.data.data : [];
      const nextPagination = readPagination(res.data, rows.length);

      setCourses(rows);
      setPagination(nextPagination);

      // Unenrolling, or a course being deleted, can leave the client asking for
      // a page the server no longer has. Without this the table renders empty
      // and looks broken.
      const safePage = clampPage(requestedPage, nextPagination.totalPages);

      if (safePage !== requestedPage) {
        setPage(safePage);
      }
    } catch (requestError) {
      if (version !== requestVersion.current) return;

      // A 401 is already handled by the axios interceptor, which clears the
      // session and redirects; there is no point reporting it here.
      if (requestError.response?.status === 401) return;

      setError(
        requestError.response?.data?.message ||
          'Your enrolled courses could not be loaded.',
      );
      setCourses([]);
      setPagination(EMPTY_PAGINATION);
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [load, page]);

  const goToPage = useCallback((nextPage) => {
    setPage((current) => {
      const target = Math.max(1, Math.floor(nextPage) || 1);
      return target === current ? current : target;
    });
  }, []);

  const reload = useCallback(() => load(page), [load, page]);

  return {
    courses,
    pagination,
    page,
    loading,
    error,
    goToPage,
    reload,
  };
}
