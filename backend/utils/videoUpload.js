const crypto = require("crypto");
const path = require("path");

const DEFAULT_MAX_VIDEO_SIZE_MB = 250;
const DEFAULT_MAX_SECTION_VIDEOS = 20;
const ALLOWED_MP4_MIME_TYPES = new Set(["video/mp4", "application/mp4"]);

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

function getVideoUploadLimits(env = process.env) {
  const maxVideoSizeMb = parsePositiveInteger(
    env.MAX_VIDEO_SIZE_MB,
    DEFAULT_MAX_VIDEO_SIZE_MB,
  );
  const maxSectionVideos = parsePositiveInteger(
    env.MAX_SECTION_VIDEOS,
    DEFAULT_MAX_SECTION_VIDEOS,
  );

  return {
    maxVideoSizeMb,
    maxSectionVideos,
    fileSizeBytes: maxVideoSizeMb * 1024 * 1024,
  };
}

function isAllowedMp4File(file) {
  if (!file || typeof file !== "object") return false;
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  const mimeType = String(file.mimetype || "").toLowerCase();
  return extension === ".mp4" && ALLOWED_MP4_MIME_TYPES.has(mimeType);
}

function createVideoFileFilter() {
  return function videoFileFilter(req, file, callback) {
    if (!isAllowedMp4File(file)) {
      const error = new Error("Only valid MP4 video files are allowed");
      error.code = "INVALID_VIDEO_TYPE";
      return callback(error);
    }
    return callback(null, true);
  };
}

function createSanitizedVideoFilename() {
  return `section-video-${Date.now()}-${crypto.randomBytes(8).toString("hex")}.mp4`;
}

function createCourseVideoUpload({
  env = process.env,
  uploadsDirectory = path.resolve(__dirname, "..", "uploads"),
  multerLib,
} = {}) {
  const multer = multerLib || require("multer");
  const limits = getVideoUploadLimits(env);

  const storage = multer.diskStorage({
    destination(req, file, callback) {
      callback(null, uploadsDirectory);
    },
    filename(req, file, callback) {
      callback(null, createSanitizedVideoFilename());
    },
  });

  return multer({
    storage,
    fileFilter: createVideoFileFilter(),
    limits: {
      fileSize: limits.fileSizeBytes,
      files: limits.maxSectionVideos,
    },
  });
}

function mapUploadError(error, limits) {
  if (error?.code === "LIMIT_FILE_SIZE") {
    return {
      status: 413,
      body: {
        success: false,
        message: `Video exceeds the ${limits.maxVideoSizeMb} MB upload limit`,
      },
    };
  }

  if (
    error?.code === "LIMIT_FILE_COUNT" ||
    error?.code === "LIMIT_UNEXPECTED_FILE"
  ) {
    return {
      status: 400,
      body: {
        success: false,
        message: `A maximum of ${limits.maxSectionVideos} section videos can be uploaded`,
      },
    };
  }

  if (error?.code === "INVALID_VIDEO_TYPE") {
    return {
      status: 400,
      body: {
        success: false,
        message: "Only valid MP4 video files are allowed",
      },
    };
  }

  return {
    status: 400,
    body: {
      success: false,
      message: "Invalid video upload",
    },
  };
}

module.exports = {
  ALLOWED_MP4_MIME_TYPES,
  DEFAULT_MAX_SECTION_VIDEOS,
  DEFAULT_MAX_VIDEO_SIZE_MB,
  createCourseVideoUpload,
  createSanitizedVideoFilename,
  createVideoFileFilter,
  getVideoUploadLimits,
  isAllowedMp4File,
  mapUploadError,
  parsePositiveInteger,
};
