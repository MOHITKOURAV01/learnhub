import { useEffect, useState } from "react";
import PropTypes from "prop-types";

import axiosInstance from "../common/AxiosInstance";
import RatingStars from "./RatingStars";
import { EMPTY_SUMMARY, normalizeSummary } from "../../lib/ratingSummaries";
import "./CourseReviews.css";

// This badge used to fetch its own summary unconditionally, so a list of twelve
// cards meant twelve requests and twelve aggregations. A parent that already
// has the numbers — the catalogue asks for the whole page in one request now —
// passes them in through `summary` and no request is made at all.
//
// The self-fetching path is kept for the single-course case, where there is no
// page to batch with.

const CourseRatingBadge = ({ courseId, compact = false, summary = null }) => {
  const [fetched, setFetched] = useState(null);

  const provided = summary ? normalizeSummary(summary) : null;
  const hasSummary = provided !== null;

  useEffect(() => {
    // Nothing to fetch when the parent already batched this page's ratings.
    if (!courseId || hasSummary) return undefined;

    let active = true;

    axiosInstance
      .get(`/api/reviews/${courseId}/summary`)
      .then((response) => {
        if (active && response.data.success) {
          setFetched(normalizeSummary(response.data.data));
        }
      })
      .catch(() => {
        if (active) {
          setFetched(null);
        }
      });

    return () => {
      active = false;
    };
    // Keyed on the boolean, not on `summary` itself: the object identity
    // changes on every render of the parent while the answer does not.
  }, [courseId, hasSummary]);

  const value = provided || fetched || EMPTY_SUMMARY;

  return (
    <div className={`course-rating-badge ${compact ? "is-compact" : ""}`}>
      <RatingStars value={value.averageRating} readOnly size="0.95rem" />
      <strong>{value.averageRating || "New"}</strong>
      <span>
        {value.totalReviews}{" "}
        {value.totalReviews === 1 ? "review" : "reviews"}
      </span>
    </div>
  );
};

CourseRatingBadge.propTypes = {
  courseId: PropTypes.string,
  compact: PropTypes.bool,
  summary: PropTypes.shape({
    averageRating: PropTypes.number,
    totalReviews: PropTypes.number,
  }),
};

export default CourseRatingBadge;
