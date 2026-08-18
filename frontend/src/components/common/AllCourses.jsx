import React, { useContext, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { MDBCol, MDBInput, MDBRow } from "mdb-react-ui-kit";
import { Link, useNavigate } from "react-router-dom";
import { UserContext } from "../../App";
import CourseRatingBadge from "../reviews/CourseRatingBadge";
import axiosInstance from "./AxiosInstance";
import BookmarkButton from "../bookmarks/BookmarkButton";
import CatalogPager from "./CatalogPager";
import useCourseCatalog from "../../hooks/useCourseCatalog";
import {
  SORT_OPTIONS,
  describeRange,
  isPaidCourse,
} from "../../lib/catalogQuery";

const paletteByCategory = [
  ["#f2c14e", "#e56b6f"],
  ["#5b8def", "#a98bfa"],
  ["#35a77c", "#b8d85c"],
  ["#e87a5d", "#f3b562"],
  ["#694fad", "#ef9aa8"],
  ["#267a8c", "#82c9b7"],
];

const levelForCourse = (course, index) => {
  if (course.C_level) return course.C_level;
  const levels = ["Beginner", "Intermediate", "All levels"];
  return levels[index % levels.length];
};

const descriptionForCourse = (course) =>
  course.C_description ||
  course.description ||
  `A practical introduction to ${course.C_title || "this subject"}, designed to help you build confidence through focused video lessons.`;

const CourseArtwork = ({ course, index }) => {
  const [start, end] = paletteByCategory[index % paletteByCategory.length];
  const initials = (course.C_title || "LH")
    .split(" ")
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();

  return (
    <div
      className="course-artwork"
      style={{ "--cover-start": start, "--cover-end": end }}
      aria-hidden="true"
    >
      <span className="course-art-grid" />
      <span className="course-art-ring" />
      <strong>{initials}</strong>
      <small>{course.C_categories || "LearnHub original"}</small>
    </div>
  );
};

const AllCourses = () => {
  const navigate = useNavigate();
  const user = useContext(UserContext);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [cardDetails, setCardDetails] = useState({
    cardholdername: "",
    cardnumber: "",
    cvvcode: "",
    expmonthyear: "",
  });

  // The search, the filter and the paging all happen on the server now. This
  // page used to fetch once with no query, receive the default first twelve
  // courses, and filter those twelve in the browser — so course thirteen was
  // unreachable and the search box only ever searched one page.
  const {
    courses,
    pagination,
    loading,
    error: loadError,
    search,
    setSearch,
    priceType,
    setPriceType,
    sort,
    setSort,
    goToPage,
    clearFilters,
    reload,
    searchPending,
    hasFilters,
  } = useCourseCatalog();

  const resetPaymentForm = () => {
    setCardDetails({
      cardholdername: "",
      cardnumber: "",
      cvvcode: "",
      expmonthyear: "",
    });
  };

  const handleChange = (event) => {
    setCardDetails((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };

  const handleEnroll = (course) => {
    if (!user.userLoggedIn) {
      navigate("/login");
      return;
    }

    if (!isPaidCourse(course)) {
      handleSubmit(course._id, course.C_title);
      return;
    }

    setSelectedCourse(course);
  };

  const closePaymentModal = () => {
    setSelectedCourse(null);
    resetPaymentForm();
  };

  const handleSubmit = async (courseId, fallbackTitle) => {
    try {
      const res = await axiosInstance.post(
        `/api/user/enrolledcourse/${courseId}`,
        cardDetails,
      );

      alert(res.data.message);
      const targetCourse = res.data.course;

      if (targetCourse) {
        navigate(`/courseSection/${targetCourse.id}/${targetCourse.Title}`);
      } else if (fallbackTitle) {
        navigate(`/courseSection/${courseId}/${fallbackTitle}`);
      }

      closePaymentModal();
      // The learner count on the card is now stale.
      reload();
    } catch (error) {
      console.error("Unable to enroll:", error);
      alert("Enrollment could not be completed. Please try again.");
    }
  };

  return (
    <>
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <span className="sr-only">Search courses</span>
          <input
            type="search"
            placeholder="Search every course by title or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label className="catalog-filter">
          <span>Access</span>
          <select
            value={priceType}
            onChange={(event) => setPriceType(event.target.value)}
            aria-label="Filter courses by access type"
          >
            <option value="">All courses</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </label>

        <label className="catalog-filter">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort courses"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="catalog-count" aria-live="polite">
          <strong>{pagination.totalItems}</strong>
          <span>
            {pagination.totalItems === 1 ? "course" : "courses"}
            {searchPending ? " — searching…" : " found"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="course-state" role="status">
          <span className="catalog-loader" aria-hidden="true" />
          <h3>Opening the catalog…</h3>
          <p>Gathering the latest courses for you.</p>
        </div>
      ) : loadError ? (
        <div className="course-state course-state-error" role="alert">
          <span aria-hidden="true">!</span>
          <h3>Course catalog unavailable</h3>
          <p>{loadError}</p>
          <button type="button" className="button button-ink" onClick={reload}>
            Try again
          </button>
        </div>
      ) : courses.length > 0 ? (
        <div className="course-grid">
          {courses.map((course, index) => (
            <article className="catalog-card" key={course._id}>
              <CourseArtwork course={course} index={index} />

              <div className="catalog-card-body">
                <div className="course-meta-row">
                  <span className="course-category">
                    {course.C_categories || "General"}
                  </span>
                  <BookmarkButton
  courseId={course._id}
  compact
/>
                  <span className="course-level">
                    {levelForCourse(course, index)}
                  </span>
                </div>

                <h3>{course.C_title}</h3>
                <p className="course-description">{descriptionForCourse(course)}</p>

                <div className="course-instructor">
                  <CourseRatingBadge
  courseId={course._id}
  compact
/>
                  <span className="instructor-avatar" aria-hidden="true">
                    {(course.C_educator || "L").charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <small>CREATED BY</small>
                    <strong>{course.C_educator || "LearnHub educator"}</strong>
                  </div>
                </div>

                <div className="course-card-footer">
                  <div>
                    <small>ACCESS</small>
                    <strong>{isPaidCourse(course) ? course.C_price : "Free"}</strong>
                  </div>
                  <div>
                    <small>LEARNERS</small>
                    <strong>{course.enrolled || 0}</strong>
                  </div>

                  {user.userLoggedIn ? (
                    <button
                      type="button"
                      className="course-enroll-button"
                      onClick={() => handleEnroll(course)}
                    >
                      Enroll
                      <span aria-hidden="true">↗</span>
                    </button>
                  ) : (
                    <Link className="course-enroll-button" to="/login">
                      Sign in to enroll
                      <span aria-hidden="true">↗</span>
                    </Link>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="course-state">
          <span aria-hidden="true">○</span>
          <h3>
            {hasFilters
              ? "No courses match that search"
              : "There are no courses yet"}
          </h3>
          <p>
            {hasFilters
              ? "Every course is searched, so try a broader keyword or switch the access filter."
              : "Check back once an educator publishes one."}
          </p>
          {hasFilters && (
            <button
              type="button"
              className="button button-outline"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {!loading && !loadError && courses.length > 0 && (
        <>
          <p className="catalog-range" aria-live="polite">
            {describeRange(pagination, courses.length)}
          </p>

          <CatalogPager
            pagination={pagination}
            onPageChange={goToPage}
            disabled={loading}
          />
        </>
      )}

      <Modal show={Boolean(selectedCourse)} onHide={closePaymentModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            Enroll in {selectedCourse?.C_title}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <div className="payment-course-summary">
            <span>{selectedCourse?.C_categories || "Course"}</span>
            <strong>{selectedCourse?.C_educator}</strong>
            <b>{selectedCourse?.C_price}</b>
          </div>

          <Form
            onSubmit={(event) => {
              event.preventDefault();
              handleSubmit(selectedCourse?._id, selectedCourse?.C_title);
            }}
          >
            <MDBInput
              className="mb-3"
              label="Card holder name"
              name="cardholdername"
              value={cardDetails.cardholdername}
              onChange={handleChange}
              type="text"
              placeholder="Name on card"
              required
            />
            <MDBInput
              className="mb-3"
              name="cardnumber"
              value={cardDetails.cardnumber}
              onChange={handleChange}
              label="Card number"
              type="text"
              maxLength="16"
              inputMode="numeric"
              placeholder="1234 5678 9012 3457"
              required
            />
            <MDBRow className="mb-4">
              <MDBCol md="6">
                <MDBInput
                  name="expmonthyear"
                  value={cardDetails.expmonthyear}
                  onChange={handleChange}
                  className="mb-3"
                  label="Expiration"
                  type="text"
                  placeholder="MM/YYYY"
                  required
                />
              </MDBCol>
              <MDBCol md="6">
                <MDBInput
                  name="cvvcode"
                  value={cardDetails.cvvcode}
                  onChange={handleChange}
                  className="mb-3"
                  label="CVV"
                  type="password"
                  inputMode="numeric"
                  maxLength="3"
                  placeholder="•••"
                  required
                />
              </MDBCol>
            </MDBRow>

            <div className="payment-actions">
              <Button variant="light" type="button" onClick={closePaymentModal}>
                Cancel
              </Button>
              <Button variant="dark" type="submit">
                Complete mock payment
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </>
  );
};

export default AllCourses;
