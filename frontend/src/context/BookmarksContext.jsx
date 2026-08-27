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
import { useAuth } from "../auth/authContext";
import {
  bookmarkDenialMessage,
  bookmarkDenialReason,
  shouldLoadBookmarks,
} from "../lib/bookmarkAccess";

const BookmarksContext = createContext(null);

export const BookmarksProvider = ({ children }) => {
  const [bookmarkIds, setBookmarkIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const requestVersion = useRef(0);

  // This provider wraps the whole application, so anything it does on mount it
  // does on every page. It used to fetch the wishlist for anyone holding a
  // token, and `/api/bookmarks` is student-only, so an educator or an admin
  // paid one failed authenticated round trip per page load and got a 403 in
  // the console for it (#115).
  //
  // The session comes from AuthProvider rather than from a bare getToken(),
  // because the role is the thing being asked about and readSession is what
  // validates the token it came with. getToken stays imported for the same
  // reason it always was — the axios interceptor owns the storage keys.
  const { user, isAuthenticated: hasSession } = useAuth();

  const isAuthenticated = hasSession && Boolean(getToken());
  const enabled = shouldLoadBookmarks(user, isAuthenticated);

  const refreshBookmarks = useCallback(async () => {
    if (!enabled) {
      // `ready` still settles. Anything waiting on it — a page deciding
      // whether to render an empty state — would otherwise wait forever.
      setBookmarkIds(new Set());
      setReady(true);
      return;
    }

    const version = ++requestVersion.current;
    setLoading(true);

    try {
      const response = await axiosInstance.get("/api/bookmarks?limit=50");

      if (version !== requestVersion.current) return;

      const ids = (response.data.data || [])
        .map((item) => item.course?.id)
        .filter(Boolean);

      setBookmarkIds(new Set(ids));
    } catch (error) {
      if (version === requestVersion.current) {
        console.error("Unable to load saved courses:", error);
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
        setReady(true);
      }
    }
  }, [enabled]);

  useEffect(() => {
    refreshBookmarks();
  }, [refreshBookmarks]);

  useEffect(() => {
    const sync = (event) => {
      const detail = event.detail || {};

      if (!detail.courseId) return;

      setBookmarkIds((current) => {
        const next = new Set(current);

        if (detail.bookmarked) next.add(detail.courseId);
        else next.delete(detail.courseId);

        return next;
      });
    };

    window.addEventListener("learnhub:bookmark-change", sync);
    return () =>
      window.removeEventListener("learnhub:bookmark-change", sync);
  }, []);

  const setBookmarkLocally = useCallback((courseId, bookmarked) => {
    setBookmarkIds((current) => {
      const next = new Set(current);

      if (bookmarked) next.add(courseId);
      else next.delete(courseId);

      return next;
    });

    window.dispatchEvent(
      new CustomEvent("learnhub:bookmark-change", {
        detail: { courseId, bookmarked },
      }),
    );
  }, []);

  const toggleBookmark = useCallback(
    async (courseId) => {
      // Two reasons used to be one. A signed-out visitor is sent to the login
      // screen — the feature is theirs. An educator cannot get one by signing
      // in again, and firing the request only to be told 403 helps nobody.
      const denial = bookmarkDenialReason(user, isAuthenticated);

      if (denial) {
        const error = new Error(bookmarkDenialMessage(denial));
        error.code = denial === "signed-out" ? "AUTH_REQUIRED" : "ROLE_REQUIRED";
        throw error;
      }

      const wasBookmarked = bookmarkIds.has(courseId);
      const nextValue = !wasBookmarked;

      setBookmarkLocally(courseId, nextValue);

      try {
        if (nextValue) {
          await axiosInstance.post(`/api/bookmarks/${courseId}`, {});
        } else {
          await axiosInstance.delete(`/api/bookmarks/${courseId}`);
        }

        return nextValue;
      } catch (error) {
        setBookmarkLocally(courseId, wasBookmarked);
        throw error;
      }
    },
    [
      bookmarkIds,
      isAuthenticated,
      setBookmarkLocally,
      user,
    ],
  );

  const removeBookmark = useCallback(
    async (courseId) => {
      if (!bookmarkIds.has(courseId)) return;

      setBookmarkLocally(courseId, false);

      try {
        await axiosInstance.delete(`/api/bookmarks/${courseId}`);
      } catch (error) {
        setBookmarkLocally(courseId, true);
        throw error;
      }
    },
    [bookmarkIds, setBookmarkLocally],
  );

  const clearAllBookmarks = useCallback(async () => {
    const previous = new Set(bookmarkIds);
    setBookmarkIds(new Set());

    try {
      await axiosInstance.delete("/api/bookmarks");
      window.dispatchEvent(
        new CustomEvent("learnhub:bookmarks-cleared"),
      );
    } catch (error) {
      setBookmarkIds(previous);
      throw error;
    }
  }, [bookmarkIds]);

  const value = useMemo(
    () => ({
      bookmarkIds,
      bookmarkCount: bookmarkIds.size,
      isBookmarked: (courseId) => bookmarkIds.has(courseId),
      toggleBookmark,
      removeBookmark,
      clearAllBookmarks,
      refreshBookmarks,
      loading,
      ready,
      isAuthenticated,
      // Whether this session has a wishlist at all, so a consumer can render
      // nothing rather than a control that cannot work.
      enabled,
    }),
    [
      bookmarkIds,
      toggleBookmark,
      removeBookmark,
      clearAllBookmarks,
      refreshBookmarks,
      loading,
      ready,
      isAuthenticated,
      enabled,
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
