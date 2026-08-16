import axios from 'axios';

// Fifteen call sites used to build `Authorization: Bearer ${localStorage
// .getItem("token")}` by hand, and none of them handled the 401 that the API
// returns once the one-day token expires. Both concerns live here now.

// Falls back to the previous hardcoded value so an existing local checkout
// keeps working without a .env file.
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export const TOKEN_STORAGE_KEY = 'token';
export const USER_STORAGE_KEY = 'user';

export const getToken = () => localStorage.getItem(TOKEN_STORAGE_KEY);

export const clearSession = () => {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
};

/**
 * Builds an absolute URL for a file served by the API. Components used to
 * concatenate the host inline.
 */
export const resolveMediaUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;

  return `${API_BASE_URL.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
};

/**
 * Builds the URL for a section video.
 *
 * The player sets the src of a <video> element, which cannot carry an
 * Authorization header, so the short-lived playback token returned by
 * /api/user/coursecontent/:courseid rides in the query string. It is scoped to
 * one course and to reading video, and expires in half an hour — unlike the
 * session token, which URLs and access logs have no business holding.
 *
 * @param {string} streamUrl the path the API returned for the section
 * @param {string} playbackToken
 * @returns {string}
 */
export const resolveCourseVideoUrl = (streamUrl, playbackToken) => {
  if (!streamUrl || !playbackToken) return '';

  return `${resolveMediaUrl(streamUrl)}?token=${encodeURIComponent(playbackToken)}`;
};

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
});

// Attach the bearer token to every outgoing request.
axiosInstance.interceptors.request.use((config) => {
  const token = getToken();

  if (token) {
    config.headers = config.headers || {};

    // A caller that passes its own Authorization header still wins, so an
    // explicit override remains possible.
    if (!config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  // Normalise paths so a baseURL with a path segment keeps working.
  if (typeof config.url === 'string' && !/^https?:\/\//i.test(config.url)) {
    config.url = `/${config.url.replace(/^\//, '')}`;
  }

  return config;
});

// Redirect once on an expired or rejected session instead of leaving each
// component to render an empty screen with an error in the console.
let redirecting = false;

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const requestUrl = error.config?.url || '';

    // A failed sign-in also answers 401. Redirecting from the login screen
    // back to the login screen would only discard the error message.
    const isAuthEndpoint =
      requestUrl.includes('/login') ||
      requestUrl.includes('/register') ||
      requestUrl.includes('/verify-otp') ||
      requestUrl.includes('/forgot-password') ||
      requestUrl.includes('/reset-password');

    if (status === 401 && !isAuthEndpoint) {
      clearSession();

      const onLoginScreen = window.location.pathname.startsWith('/login');

      if (!redirecting && !onLoginScreen) {
        redirecting = true;
        window.location.assign('/login?session=expired');
      }
    }

    return Promise.reject(error);
  },
);

export default axiosInstance;
