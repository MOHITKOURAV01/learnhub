import { useCallback, useEffect, useRef, useState } from 'react';

import axiosInstance from '../components/common/AxiosInstance';
import { clampPage, readPagination } from '../lib/catalogQuery';
import { PAGE_SIZE } from '../lib/adminListing';

// One request owner for both admin tables (#96).
//
// The users table and the courses table did the same thing differently: both
// fetched everything on mount, one of them handled errors and the other logged
// them, and neither paged. The endpoints are paginated now, so the paging,
// the debounce, the stale-response guard and the error handling live here once
// and each table supplies its own endpoint, params and row reader.

const EMPTY_PAGINATION = {
  page: 1,
  limit: PAGE_SIZE,
  totalItems: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

const SEARCH_DEBOUNCE_MS = 300;

/**
 * @param {object} options
 * @param {string} options.url the endpoint to call
 * @param {(state: object) => object} options.buildParams
 * @param {(payload: unknown) => Array} options.readRows
 * @param {(payload: unknown) => unknown} [options.readSummary]
 * @param {object} [options.initialFilters] extra filter state, e.g. { role: '' }
 * @param {string} [options.errorMessage]
 */
export default function useAdminList({
  url,
  buildParams,
  readRows,
  readSummary,
  initialFilters = {},
  errorMessage = 'That list could not be loaded.',
}) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [filters, setFilters] = useState({ sort: 'newest', ...initialFilters });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // A slow request for page one landing after a fast one for page two would
  // put the wrong rows on screen.
  const requestVersion = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (requestedPage, requestedSearch, requestedFilters) => {
      const version = ++requestVersion.current;

      setLoading(true);
      setError('');

      try {
        const res = await axiosInstance.get(url, {
          params: buildParams({
            page: requestedPage,
            search: requestedSearch,
            ...requestedFilters,
          }),
        });

        if (version !== requestVersion.current) return;

        if (!res.data?.success) {
          setError(res.data?.message || errorMessage);
          setRows([]);
          setPagination(EMPTY_PAGINATION);
          return;
        }

        const nextRows = readRows(res.data);
        const nextPagination = readPagination(res.data, nextRows.length);

        setRows(nextRows);
        setPagination(nextPagination);

        if (readSummary) setSummary(readSummary(res.data));

        // Deleting the last row on a page leaves the client asking for a page
        // the server no longer has.
        const safePage = clampPage(requestedPage, nextPagination.totalPages);

        if (safePage !== requestedPage) setPage(safePage);
      } catch (requestError) {
        if (version !== requestVersion.current) return;

        // A 401 is already handled by the axios interceptor, which clears the
        // session and redirects.
        if (requestError.response?.status === 401) return;

        setError(requestError.response?.data?.message || errorMessage);
        setRows([]);
        setPagination(EMPTY_PAGINATION);
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [buildParams, errorMessage, readRows, readSummary, url],
  );

  useEffect(() => {
    load(page, appliedSearch, filters);
  }, [load, page, appliedSearch, filters]);

  const goToPage = useCallback((nextPage) => {
    setPage((current) => {
      const target = Math.max(1, Math.floor(nextPage) || 1);
      return target === current ? current : target;
    });
  }, []);

  const setFilter = useCallback((name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setAppliedSearch('');
    setFilters({ sort: 'newest', ...initialFilters });
    setPage(1);
    // `initialFilters` is a literal at every call site, so it is stable in
    // practice; spreading it here rather than depending on it keeps the
    // callback identity stable too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(
    () => load(page, appliedSearch, filters),
    [load, page, appliedSearch, filters],
  );

  return {
    rows,
    summary,
    pagination,
    page,
    search,
    setSearch,
    filters,
    setFilter,
    clearFilters,
    loading,
    error,
    goToPage,
    reload,
    hasFilters:
      appliedSearch.length > 0 ||
      Object.entries(filters).some(
        ([key, value]) => value && !(key === 'sort' && value === 'newest'),
      ),
    searchPending: search.trim() !== appliedSearch,
  };
}
