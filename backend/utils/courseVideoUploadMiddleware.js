const {
  getVideoUploadLimits,
  mapUploadError,
} = require("./videoUpload");
const { cleanupUploadedFiles } = require("./uploadCleanup");

function createCourseVideoUploadMiddleware({
  upload,
  env = process.env,
  cleanupFiles = cleanupUploadedFiles,
  logger = console,
} = {}) {
  if (!upload || typeof upload.array !== "function") {
    throw new Error("A Multer upload instance is required");
  }

  const limits = getVideoUploadLimits(env);
  const uploadArray = upload.array("S_content", limits.maxSectionVideos);

  return function courseVideoUploadMiddleware(req, res, next) {
    uploadArray(req, res, async (error) => {
      if (!error) return next();

      const cleanupResult = await cleanupFiles(req.files);

      if (cleanupResult.failed.length > 0) {
        logger.warn(
          "Video upload validation failed and some temporary files could not be removed",
          { failedFiles: cleanupResult.failed.length },
        );
      }

      const mapped = mapUploadError(error, limits);
      return res.status(mapped.status).send(mapped.body);
    });
  };
}

module.exports = { createCourseVideoUploadMiddleware };
