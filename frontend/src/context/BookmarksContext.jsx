import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import axiosInstance, {
  getToken,
} from "../components/common/AxiosInstance";
import {
  adjustTotal,
  applyClear,
  applyToggle,
  buildStatusParams,
  chunkIds,
  collectPendingIds,
  emptyStatus,
  mergeStatus,
  normalizeCourseId,
  readSavedTotal,
  readStatusIds,
} from "../lib/bookmarkStatus";

// #103. Every filled star in the application used to be decided by one request:
//
//   const response = await axiosInstance.get("/api/bookmarks?limit=50");
//   setBookmarkIds(new Set(ids));
//
// That is page one of the wishlist. `GET /api/bookmarks` is paginated and caps
// `limit` at 50, so a student with more saved courses than that had the rest
// render hollow — and since `toggleBookmark` read its starting value from the
// same Set, clicking one of them sent an add rather than the remove the user
// asked for. `addBookmark` upserts, so nothing happened and nothing said so.
//
// `GET /api/bookmarks/status?courseIds=…` answers the question a star actually
// asks, for the ids on screen, in one indexed query. It has existed since the
// wishlist was built and nothing in `frontend/` called it.
//
// Ids are collected per tick and asked about in one batch, so a twelve-card
// catalogue page costs one request rather than twelve — the same shape
// `useRatingSummaries` uses for the rating badges.

const BookmarksContext = createContext(null);

export const BookmarksProvider = ({ children }) => {
  const [status, setStatus] = useState(emptyStatus);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  const isAuthenticated = Boolean(getToken());

  // Ids seen this tick, waiting to be asked about together.
  const queuedIds = useRef(new Set());
  // Ids with a request already out. Without this, a re-render between the
  // request and its reply queues the same ids a second time.
  const inFlightIds = useRef(new Set());
  const flushHandle = useRef(null);
  // Bumped whenever the session changes, so a reply for the previous account
  // cannot land in the new one's state.
  const sessionVersion = useRef(0);
  // `status` is read inside callbacks that must not re-create themselves every
  // time a star changes, so the current value is mirrored here.
  const statusRef = useRef(status);

  statusRef.current = status;

  const resetQueues = useCallback(() => {
    if (flushHandle.current) {
      clearTimeout(flushHandle.current);
      flushHandle.current = null;
    }

    queuedIds.current = new Set();
    inFlightIds.current = new Set();
  }, []);

  /**
   * Asks the server about one batch of ids and folds the answer in.
   *
   * Both halves of the reply are recorded: the ids that came back are saved,
   * and the ids that were asked about and did not come back are known not to
   * be. That distinction is what the old single Set could not express.
   */
  const requestStatusFor = useCallback(async (batch, version) => {
    const params = buildStatusParams(batch);

    if (!params) return;

    batch.forEach((id) => inFlightIds.current.add(id));

    try {
      const response = await axiosInstance.get("/api/bookmarks/status", {
        params,
      });

      if (version !== sessionVersion.current) return;

      setStatus((current) =>
        mergeStatus(current, {
          requested: batch,
          saved: readStatusIds(response.data),
        }),
      );
    } catch (error) {
      // A star is decoration on a card. If the lookup fails the cards still
      // render, unstarred, and the ids stay unresolved so the next page view
      // asks again rather than caching a wrong answer.
      console.error("Unable to check saved-course status:", error);
    } finally {
      batch.forEach((id) => inFlightIds.current.delete(id));
    }
  }, []);

  const flushQueue = useCallback(() => {
    flushHandle.current = null;

    const requested = [...queuedIds.current];
    queuedIds.current = new Set();

    if (requested.length === 0) return;

    const pending = collectPendingIds(requested, {
      resolved: statusRef.current.resolved,
      inFlight: inFlightIds.current,
    });

    const version = sessionVersion.current;

    chunkIds(pending).forEach((batch) => {
      requestStatusFor(batch, version);
    });
  }, [requestStatusFor]);

  /**
   * Registers the courses currently on screen.
   *
   * Called by every `BookmarkButton` as it mounts. The ids gather over the
   * current tick and go out as one request, so a page of cards does not become
   * a page of requests.
   *
   * @param {unknown|unknown[]} courseIds
   */
  const trackCourses = useCallback(
    (courseIds) => {
      if (!isAuthenticated) return;

      const list = Array.isArray(courseIds) ? courseIds : [courseIds];
      let queued = false;

      for (const candidate of list) {
        const id = normalizeCourseId(candidate);

        if (!id) continue;
        if (statusRef.current.resolved.has(id)) continue;
        if (inFlightIds.current.has(id)) continue;

        queuedIds.current.add(id);
        queued = true;
      }

      if (!queued || flushHandle.current) return;

      flushHandle.current = setTimeout(flushQueue, 0);
    },
    [flushQueue, isAuthenticated],
  );

  /**
   * Reads the real number of saved courses.
   *
   * One row is enough — the count lives in `pagination.totalItems`. The header
   * on `/saved-courses` used to print the size of the truncated Set while the
   * result summary beneath it printed this, so one screen carried two different
   * numbers.
   */
  const refreshBookmarks = useCallback(async () => {
    if (!isAuthenticated) {
      resetQueues();
      setStatus(emptyStatus());
      setTotal(0);
      setReady(true);
      return;
    }

    const version = sessionVersion.current;

    setLoading(true);

    try {
      const response = await axiosInstance.get("/api/bookmarks", {
        params: { page: 1, limit: 1 },
      });

      if (version !== sessionVersion.current) return;

      const count = readSavedTotal(response.data);

      if (count !== null) setTotal(count);
    } catch (error) {
      if (version === sessionVersion.current) {
        console.error("Unable to load saved courses:", error);
      }
    } finally {
      if (version === sessionVersion.current) {
        setLoading(false);
        setReady(true);
      }
    }
  }, [isAuthenticated, resetQueues]);

  useEffect(() => {
    // Signing in or out invalidates every cached answer, including the negative
    // ones, so the whole cache goes rather than only the saved half.
    sessionVersion.current += 1;
    resetQueues();
    setStatus(emptyStatus());
    setTotal(0);
    setReady(false);

    refreshBookmarks();
  }, [refreshBookmarks, resetQueues]);

  useEffect(() => () => resetQueues(), [resetQueues]);

  useEffect(() => {
    const sync = (event) => {
      const courseId = normalizeCourseId(event.detail?.courseId);

      if (!courseId) return;

      setStatus((current) =>
        applyToggle(current, courseId, Boolean(event.detail?.bookmarked)),
      );
    };

    window.addEventListener("learnhub:bookmark-change", sync);
    return () =>
      window.removeEventListener("learnhub:bookmark-change", sync);
  }, []);

  const setBookmarkLocally = useCallback((courseId, bookmarked) => {
    const id = normalizeCourseId(courseId);

    if (!id) return;

    setStatus((current) => applyToggle(current, id, bookmarked));

    window.dispatchEvent(
      new CustomEvent("learnhub:bookmark-change", {
        detail: { courseId: id, bookmarked },
      }),
    );
  }, []);

  const toggleBookmark = useCallback(
    async (courseId) => {
      if (!isAuthenticated) {
        const error = new Error("Sign in to save courses.");
        error.code = "AUTH_REQUIRED";
        throw error;
      }

      const id = normalizeCourseId(courseId);

      if (!id) {
        throw new Error("That course cannot be saved.");
      }

      const wasBookmarked = statusRef.current.saved.has(id);
      const nextValue = !wasBookmarked;

      setBookmarkLocally(id, nextValue);
      setTotal((current) => adjustTotal(current, nextValue ? 1 : -1));

      try {
        if (nextValue) {
          await axiosInstance.post(`/api/bookmarks/${id}`, {});
        } else {
          await axiosInstance.delete(`/api/bookmarks/${id}`);
        }

        return nextValue;
      } catch (error) {
        setBookmarkLocally(id, wasBookmarked);
        setTotal((current) => adjustTotal(current, nextValue ? -1 : 1));
        throw error;
      }
    },
    [isAuthenticated, setBookmarkLocally],
  );

  const removeBookmark = useCallback(
    async (courseId) => {
      const id = normalizeCourseId(courseId);

      if (!id || !statusRef.current.saved.has(id)) return;

      setBookmarkLocally(id, false);
      setTotal((current) => adjustTotal(current, -1));

      try {
        await axiosInstance.delete(`/api/bookmarks/${id}`);
      } catch (error) {
        setBookmarkLocally(id, true);
        setTotal((current) => adjustTotal(current, 1));
        throw error;
      }
    },
    [setBookmarkLocally],
  );

  const clearAllBookmarks = useCallback(async () => {
    const previousStatus = statusRef.current;
    const previousTotal = total;

    setStatus((current) => applyClear(current));
    setTotal(0);

    try {
      await axiosInstance.delete("/api/bookmarks");
      window.dispatchEvent(
        new CustomEvent("learnhub:bookmarks-cleared"),
      );
    } catch (error) {
      setStatus(previousStatus);
      setTotal(previousTotal);
      throw error;
    }
  }, [total]);

  const isBookmarked = useCallback(
    (courseId) => status.saved.has(normalizeCourseId(courseId)),
    [status],
  );

  const value = useMemo(
    () => ({
      // Kept under its original name: `bookmarkIds` is what the provider has
      // always exposed, and it still means "the courses known to be saved".
      bookmarkIds: status.saved,
      // The server's count, not the size of a page. These were two different
      // numbers on the same screen.
      bookmarkCount: total,
      isBookmarked,
      trackCourses,
      toggleBookmark,
      removeBookmark,
      clearAllBookmarks,
      refreshBookmarks,
      loading,
      ready,
      isAuthenticated,
    }),
    [
      status,
      total,
      isBookmarked,
      trackCourses,
      toggleBookmark,
      removeBookmark,
      clearAllBookmarks,
      refreshBookmarks,
      loading,
      ready,
      isAuthenticated,
    ],
  );

  return (
    <BookmarksContext.Provider value={value}>
      {children}
    </BookmarksContext.Provider>
  );
};

export const useBookmarks = () => {
  const context = useContext(BookmarksContext);

  if (!context) {
    throw new Error(
      "useBookmarks must be used inside BookmarksProvider.",
    );
  }

  return context;
};
