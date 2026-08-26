import { useCallback, useEffect, useRef, useState } from 'react';

import axiosInstance from '../components/common/AxiosInstance';
import { clampPage, readPagination } from '../lib/catalogQuery';
import {
  PAGE_SIZE,
  buildTeacherParams,
  readCourses,
  readSummary,
} from '../lib/teacherCourses';

// Owns the request for the educator dashboard.
//
// TeacherHome used to call the endpoint on mount, keep whatever came back, and
// swallow any failure into a `console.log` — leaving `allCourses` at `[]` and
// the page rendering the string 'No courses found!!'. An educator with twenty
// published courses was told they had none, and the only trace was in the
// console (#94).

const EMPTY_PAGINATION = {
  page: 1,
  limit: PAGE_SIZE,
  totalItems: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

const SEARCH_DEBOUNCE_MS = 300;
const LOAD_FAILED = 'Your courses could not be loaded.';

export default function useTeacherCourses() {
  const [courses, setCourses] = useState([]);
  const [summary, setSummary] = useState({ courses: 0, learners: 0 });
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sort, setSort] = useState('newest');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // A slow request for page one landing after a fast one for page two would
  // put the wrong rows on screen. Every request takes a ticket and only the
  // newest one may write state.
  const requestVersion = useRef(0);

  // Typing a title should not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (requestedPage, requestedSearch, requestedSort) => {
      const version = ++requestVersion.current;

      setLoading(true);
      setError('');

      try {
        const res = await axiosInstance.get('/api/user/getallcoursesteacher', {
          params: buildTeacherParams({
            page: requestedPage,
            search: requestedSearch,
            sort: requestedSort,
          }),
        });

        if (version !== requestVersion.current) return;

        if (!res.data?.success) {
          setError(res.data?.message || LOAD_FAILED);
          setCourses([]);
          setPagination(EMPTY_PAGINATION);
          return;
        }

        const rows = readCourses(res.data);
        const nextPagination = readPagination(res.data, rows.length);

        setCourses(rows);
        setSummary(readSummary(res.data));
        setPagination(nextPagination);

        // Deleting the last course on a page leaves the client asking for a
        // page the server no longer has.
        const safePage = clampPage(requestedPage, nextPagination.totalPages);

        if (safePage !== requestedPage) {
          setPage(safePage);
        }
      } catch (requestError) {
        if (version !== requestVersion.current) return;

        // A 401 is already handled by the axios interceptor, which clears the
        // session and redirects; reporting it here would only flash a message
        // on the way out.
        if (requestError.response?.status === 401) return;

        setError(requestError.response?.data?.message || LOAD_FAILED);
        setCourses([]);
        setPagination(EMPTY_PAGINATION);
      } finally {
        if (version === requestVersion.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    load(page, appliedSearch, sort);
  }, [load, page, appliedSearch, sort]);

  const goToPage = useCallback((nextPage) => {
    setPage((current) => {
      const target = Math.max(1, Math.floor(nextPage) || 1);
      return target === current ? current : target;
    });
  }, []);

  const changeSort = useCallback((nextSort) => {
    setSort(nextSort);
    setPage(1);
  }, []);

  const clearSearch = useCallback(() => {
    setSearch('');
    setAppliedSearch('');
    setPage(1);
  }, []);

  const reload = useCallback(
    () => load(page, appliedSearch, sort),
    [load, page, appliedSearch, sort],
  );

  return {
    courses,
    summary,
    pagination,
    page,
    search,
    setSearch,
    sort,
    setSort: changeSort,
    loading,
    error,
    goToPage,
    clearSearch,
    reload,
    hasSearch: appliedSearch.length > 0,
    searchPending: search.trim() !== appliedSearch,
  };
}
