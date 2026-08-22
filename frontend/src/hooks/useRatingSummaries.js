import { useEffect, useMemo, useRef, useState } from 'react';

import axiosInstance from '../components/common/AxiosInstance';
import {
  buildSummaryParams,
  collectCourseIds,
  readSummaryMap,
} from '../lib/ratingSummaries';

/**
 * Fetches the rating summaries for a page of courses in one request.
 *
 * CourseRatingBadge used to fetch its own, so a twelve-card catalogue page
 * issued twelve requests on top of the one for the courses, and another burst
 * every time a search or a page change replaced the result set.
 *
 * @param {Array<{ _id?: string }>} rows the courses currently on screen
 * @returns {{ summaries: Map<string, object>, loading: boolean }}
 */
export default function useRatingSummaries(rows) {
  const [summaries, setSummaries] = useState(() => new Map());
  const [loading, setLoading] = useState(false);

  const courseIds = useMemo(() => collectCourseIds(rows), [rows]);

  // The identity of `courseIds` changes on every render of the parent, but the
  // page it describes usually has not. Keying the effect on the joined list
  // means paging back and forth does not re-request the same set.
  const key = courseIds.join(',');

  // A slow request for page one landing after a fast one for page two would
  // put the wrong ratings under the wrong cards.
  const requestVersion = useRef(0);

  useEffect(() => {
    // Rebuilt from `key` rather than closed over, so the effect's only
    // dependency is the string that actually decides whether to re-request.
    const params = buildSummaryParams(key ? key.split(',') : []);

    if (!params) {
      setSummaries(new Map());
      return undefined;
    }

    const version = ++requestVersion.current;
    let active = true;

    setLoading(true);

    axiosInstance
      .get('/api/reviews/summaries', { params })
      .then((response) => {
        if (!active || version !== requestVersion.current) return;

        if (response.data?.success) {
          setSummaries(readSummaryMap(response.data));
        }
      })
      .catch(() => {
        // A rating is decoration on a course card. If the request fails the
        // cards should still render; every badge falls back to "New".
        if (active && version === requestVersion.current) {
          setSummaries(new Map());
        }
      })
      .finally(() => {
        if (active && version === requestVersion.current) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [key]);

  return { summaries, loading };
}
