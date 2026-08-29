// GET /api/user/getallcourses has no authMiddleware on it — the catalogue is
// meant to be browsable by a visitor — and courseListingController returned
// whole course documents. `sections` was part of that, and every section
// carries `S_content.path`, the storage path of the video.
//
// So the public endpoint published the location of every video in the system.
// Anyone could read the list and fetch the files. The paths were never a
// secret and were never meant to be one; the fix is that they are not needed
// by anybody browsing a catalogue.

/**
 * Strips a course down to what a catalogue card renders.
 *
 * `sections` is replaced by a count. The card already shows nothing from
 * inside a section, and a visitor deciding whether to enrol is better served
 * by "12 lessons" than by a list of filenames.
 *
 * @param {object} course a lean course document
 * @returns {object}
 */
function toPublicCourse(course) {
  if (!course || typeof course !== "object") return course;

  const { sections, ...rest } = course;

  return {
    ...rest,
    // The field is declared as `{}` on the schema, so it holds whatever was
    // written. Only an array can be counted; anything else reads as zero
    // rather than throwing.
    sectionCount: Array.isArray(sections) ? sections.length : 0,
  };
}

/**
 * @param {object[]} courses
 * @returns {object[]}
 */
function toPublicCourses(courses) {
  return Array.isArray(courses) ? courses.map(toPublicCourse) : [];
}

/**
 * Rewrites a course's sections for an enrolled viewer.
 *
 * The storage path is replaced with the guarded stream URL. The client used to
 * build `${host}/uploads/${path}` itself, which only worked because the
 * directory was public.
 *
 * @param {unknown} sections
 * @param {string} courseId
 * @returns {object[]}
 */
function withPlaybackUrls(sections, courseId) {
  if (!Array.isArray(sections)) return [];

  return sections.map((section, index) => {
    if (!section || typeof section !== "object") return section;

    const { S_content, ...rest } = section;

    if (!S_content) {
      return { ...rest, S_content: null };
    }

    return {
      ...rest,
      S_content: {
        streamUrl: `/api/user/coursevideo/${courseId}/${index}`,
      },
    };
  });
}

module.exports = {
  toPublicCourse,
  toPublicCourses,
  withPlaybackUrls,
};
