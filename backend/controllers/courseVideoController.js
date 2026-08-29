const fs = require("fs");
const fsPromises = require("fs/promises");

const { resolveSafeUploadPath } = require("../utils/courseFileCleanup");
const {
  buildFullResponseHeaders,
  buildRangeResponseHeaders,
  parseRangeHeader,
} = require("../utils/rangeRequests");
const {
  tokenCoversCourse,
  verifyPlaybackToken,
} = require("../utils/playbackTokens");

// GET /api/user/coursevideo/:courseid/:sectionIndex?token=...
//
// Replaces `app.use("/uploads", express.static(uploadsDir))`, which served the
// upload directory to anyone who asked. Since the public catalogue also
// returned every section's stored path, the two together meant any paid
// course's videos could be downloaded with no account at all.

/**
 * Reads the section the request is asking for.
 *
 * `courseModel.sections` is declared as `{}`, so it is whatever was written to
 * it. Anything that is not an array of sections is treated as "no such
 * section" rather than being coerced.
 *
 * @param {unknown} sections
 * @param {string} rawIndex
 * @returns {object|null}
 */
function selectSection(sections, rawIndex) {
  if (!Array.isArray(sections)) return null;
  if (!/^\d+$/.test(String(rawIndex).trim())) return null;

  const index = Number(rawIndex);

  if (!Number.isSafeInteger(index) || index < 0 || index >= sections.length) {
    return null;
  }

  const section = sections[index];

  return section && typeof section === "object" ? section : null;
}

/**
 * Pulls the stored filename out of a section.
 *
 * Older rows only carry `path` ("/uploads/foo.mp4"); newer ones carry
 * `filename` as well. Both end up as a bare filename, which
 * `resolveSafeUploadPath` then confines to the uploads directory.
 *
 * @param {object} section
 * @returns {string} "" when there is nothing playable
 */
function sectionFilename(section) {
  const content = section?.S_content;

  if (!content || typeof content !== "object") return "";

  const candidate = content.filename || content.path || "";

  return typeof candidate === "string" ? candidate.trim() : "";
}

function createCourseVideoController({
  Course,
  createReadStream = fs.createReadStream,
  stat = fsPromises.stat,
  resolvePath = resolveSafeUploadPath,
  verifyToken = verifyPlaybackToken,
  logger = console,
} = {}) {
  return async function courseVideoController(req, res) {
    const CourseModel = Course || require("../schemas/courseModel");

    const { courseid, sectionIndex } = req.params;
    const token = req.query?.token;

    const claims = verifyToken(token);

    // One answer for a missing token, an expired one, one signed for a
    // different course, and one that is really a session JWT. Distinguishing
    // them would tell a caller which part of the guess was right.
    if (!tokenCoversCourse(claims, courseid)) {
      return res.status(401).send({
        success: false,
        message: "A valid playback token is required",
      });
    }

    try {
      const course = await CourseModel.findById(courseid).lean();

      if (!course) {
        return res
          .status(404)
          .send({ success: false, message: "Course not found" });
      }

      const section = selectSection(course.sections, sectionIndex);
      const filename = sectionFilename(section);

      if (!filename) {
        return res
          .status(404)
          .send({ success: false, message: "Section video not found" });
      }

      // S_content.path is data written by an upload handler, not a constant.
      // resolveSafeUploadPath takes the basename and confines the result to the
      // uploads directory, so a "../" that ever reached the database cannot
      // turn this route into an arbitrary file read.
      const filePath = resolvePath(filename);

      if (!filePath) {
        logger.warn("Rejected an unsafe section video path", {
          courseId: courseid,
          sectionIndex,
        });

        return res
          .status(404)
          .send({ success: false, message: "Section video not found" });
      }

      let stats;

      try {
        stats = await stat(filePath);
      } catch {
        // The row survives a file that was removed from disk.
        return res
          .status(404)
          .send({ success: false, message: "Section video not found" });
      }

      const size = stats.size;
      const range = parseRangeHeader(req.headers?.range, size);

      if (range === "unsatisfiable") {
        res.status(416).set({
          "Content-Range": `bytes */${size}`,
        });
        return res.end();
      }

      if (!range) {
        res.status(200).set(buildFullResponseHeaders(size));
        return createReadStream(filePath).pipe(res);
      }

      res.status(206).set(buildRangeResponseHeaders(range, size));
      return createReadStream(filePath, {
        start: range.start,
        end: range.end,
      }).pipe(res);
    } catch (error) {
      logger.error("Failed to stream course video", {
        courseId: courseid,
        message: error instanceof Error ? error.message : String(error),
      });

      if (res.headersSent) return res.end();

      return res
        .status(500)
        .send({ success: false, message: "Failed to load the video" });
    }
  };
}

const courseVideoController = (req, res) =>
  createCourseVideoController()(req, res);

module.exports = {
  courseVideoController,
  createCourseVideoController,
  sectionFilename,
  selectSection,
};
