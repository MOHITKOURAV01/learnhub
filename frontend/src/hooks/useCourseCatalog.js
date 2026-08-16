import { useCallback, useEffect, useRef, useState } from 'react';
import axiosInstance from '../components/common/AxiosInstance';
import {
  PAGE_SIZE,
  buildCatalogParams,
  clampPage,
  readPagination,
} from '../lib/catalogQuery';

// How long to wait after the last keystroke before asking the server. Short
// enough not to feel laggy, long enough that typing a course title is one
// request rather than one per character.
const SEARCH_DEBOUNCE_MS = 350;

const EMPTY_PAGINATION = {
  page: 1,
  limit: PAGE_SIZE,
  totalItems: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

/**
 * Owns the catalogue query: the filters, the page, and the request that goes
 * with them.
 *
 * The component that used this data previously fetched once on mount and then
 * filtered the twelve rows it happened to receive, so anything past the first
 * page did not exist as far as the UI was concerned.
 */
export default function useCourseCatalog() {
  const [search, setSearch] = useState('');
  const [priceType, setPriceType] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);

  const [courses, setCourses] = useState([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The search box drives this on a delay; everything else drives it at once.
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Responses can arrive out of order — a slow request for "re" landing after
  // a fast one for "react" would put the wrong results on screen. Each request
  // takes a ticket and only the newest one is allowed to write state.
  const requestId = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [search]);

  // Any change to what is being asked for starts again at page one. Staying on
  // page 4 while switching to a filter with two pages of results shows an
  // empty grid.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, priceType, sort]);

  useEffect(() => {
    const ticket = requestId.current + 1;
    requestId.current = ticket;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const res = await axiosInstance.get('/api/user/getallcourses', {
          params: buildCatalogParams({
            search: debouncedSearch,
            priceType,
            sort,
            page,
          }),
        });

        if (cancelled || ticket !== requestId.current) return;

        if (!res.data?.success) {
          setError('The course catalog is temporarily unavailable.');
          setCourses([]);
          setPagination(EMPTY_PAGINATION);
          return;
        }

        const rows = res.data.data || [];
        const meta = readPagination(res.data, rows.length);

        setCourses(rows);
        setPagination(meta);

        // The server can hold fewer pages than the client last saw — a course
        // was deleted, or a filter narrowed the set. Ask again for a page that
        // exists rather than rendering an empty grid.
        const safePage = clampPage(page, meta.totalPages);
        if (safePage !== page) {
          setPage(safePage);
        }
      } catch (requestError) {
        if (cancelled || ticket !== requestId.current) return;

        console.error('Unable to load courses:', requestError);
        setError('We could not load courses right now. Please try again.');
        setCourses([]);
        setPagination(EMPTY_PAGINATION);
      } finally {
        if (!cancelled && ticket === requestId.current) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, priceType, sort, page, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setPriceType('');
    setSort('newest');
    setPage(1);
  }, []);

  const goToPage = useCallback(
    (next) => {
      setPage((current) => {
        const target = clampPage(next, pagination.totalPages);
        return target === current ? current : target;
      });
    },
    [pagination.totalPages],
  );

  return {
    courses,
    pagination,
    loading,
    error,
    search,
    setSearch,
    priceType,
    setPriceType,
    sort,
    setSort,
    page,
    goToPage,
    clearFilters,
    reload,
    // True while the debounce is still pending, so the toolbar can say the
    // results on screen are one keystroke behind.
    searchPending: search.trim() !== debouncedSearch,
    hasFilters: Boolean(search.trim() || priceType || sort !== 'newest'),
  };
}
