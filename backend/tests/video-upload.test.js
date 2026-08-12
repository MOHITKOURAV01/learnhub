const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  createSanitizedVideoFilename,
  createVideoFileFilter,
  getVideoUploadLimits,
  isAllowedMp4File,
  mapUploadError,
} = require("../utils/videoUpload");
const {
  cleanupUploadedFiles,
  resolveUploadedFilePath,
} = require("../utils/uploadCleanup");
const {
  createCourseVideoUploadMiddleware,
} = require("../utils/courseVideoUploadMiddleware");
const {
  createPostCourseController,
} = require("../controllers/courseCreationController");

function runFilter(file) {
  return new Promise((resolve) => {
    createVideoFileFilter()({}, file, (error, accepted) => {
      resolve({ error, accepted });
    });
  });
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

test("valid MP4 files are accepted", async () => {
  const file = { originalname: "lesson.mp4", mimetype: "video/mp4" };
  assert.equal(isAllowedMp4File(file), true);
  const result = await runFilter(file);
  assert.equal(result.error, null);
  assert.equal(result.accepted, true);
});

test("renamed non-video files are rejected", async () => {
  const result = await runFilter({
    originalname: "payload.mp4",
    mimetype: "application/javascript",
  });
  assert.equal(result.error.code, "INVALID_VIDEO_TYPE");
});

test("unsupported MIME types are rejected", async () => {
  const result = await runFilter({
    originalname: "lesson.mp4",
    mimetype: "video/quicktime",
  });
  assert.equal(result.error.code, "INVALID_VIDEO_TYPE");
});

test("non-MP4 extension is rejected even with MP4 MIME", () => {
  assert.equal(
    isAllowedMp4File({
      originalname: "lesson.mov",
      mimetype: "video/mp4",
    }),
    false,
  );
});

test("defaults to 250 MB and 20 files", () => {
  const limits = getVideoUploadLimits({});
  assert.equal(limits.maxVideoSizeMb, 250);
  assert.equal(limits.maxSectionVideos, 20);
  assert.equal(limits.fileSizeBytes, 250 * 1024 * 1024);
});

test("upload limits are configurable", () => {
  const limits = getVideoUploadLimits({
    MAX_VIDEO_SIZE_MB: "64",
    MAX_SECTION_VIDEOS: "8",
  });
  assert.equal(limits.maxVideoSizeMb, 64);
  assert.equal(limits.maxSectionVideos, 8);
  assert.equal(limits.fileSizeBytes, 64 * 1024 * 1024);
});

test("invalid limit config falls back safely", () => {
  const limits = getVideoUploadLimits({
    MAX_VIDEO_SIZE_MB: "-1",
    MAX_SECTION_VIDEOS: "abc",
  });
  assert.equal(limits.maxVideoSizeMb, 250);
  assert.equal(limits.maxSectionVideos, 20);
});

test("oversized uploads return 413 without internal path", () => {
  const mapped = mapUploadError(
    { code: "LIMIT_FILE_SIZE", path: "C:\\secret\\video.mp4" },
    getVideoUploadLimits({ MAX_VIDEO_SIZE_MB: "10" }),
  );
  assert.equal(mapped.status, 413);
  assert.match(mapped.body.message, /10 MB/);
  assert.doesNotMatch(JSON.stringify(mapped.body), /secret|uploads|[A-Z]:\\/i);
});

test("too many videos returns controlled 400", () => {
  const mapped = mapUploadError(
    { code: "LIMIT_FILE_COUNT" },
    getVideoUploadLimits({ MAX_SECTION_VIDEOS: "3" }),
  );
  assert.equal(mapped.status, 400);
  assert.match(mapped.body.message, /maximum of 3/i);
});

test("generated filenames are sanitized", () => {
  const filename = createSanitizedVideoFilename();
  assert.match(
    filename,
    /^section-video-\d+-[a-f0-9]{16}\.mp4$/,
  );
  assert.equal(/[\\/]/.test(filename), false);
});

test("cleanup constrains filenames to upload directory", () => {
  const root = path.resolve("test-uploads");
  assert.equal(
    resolveUploadedFilePath(
      { filename: "../../lesson.mp4" },
      root,
    ),
    path.join(root, "lesson.mp4"),
  );
});

test("cleanup removes written files and ignores missing files", async () => {
  const calls = [];
  const result = await cleanupUploadedFiles(
    [
      { filename: "first.mp4" },
      { filename: "missing.mp4" },
    ],
    {
      uploadsDirectory: path.resolve("test-uploads"),
      unlink: async (filePath) => {
        calls.push(path.basename(filePath));
        if (filePath.endsWith("missing.mp4")) {
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        }
      },
    },
  );

  assert.deepEqual(calls, ["first.mp4", "missing.mp4"]);
  assert.deepEqual(result.deleted, ["first.mp4"]);
  assert.deepEqual(result.failed, []);
});

test("failed course creation removes uploaded files", async () => {
  const cleanupCalls = [];

  class FailingCourse {
    async save() {
      throw new Error("database unavailable");
    }
  }

  const controller = createPostCourseController({
    Course: FailingCourse,
    cleanupFiles: async (files) => {
      cleanupCalls.push(files);
      return { deleted: ["one.mp4"], failed: [] };
    },
    logger: { error() {} },
  });

  const req = {
    files: [{ filename: "one.mp4" }],
    body: {
      userId: "teacher-1",
      C_educator: "Teacher",
      C_title: "Course",
      C_categories: "Programming",
      C_price: "0",
      C_description: "Description",
      S_title: "Section",
      S_description: "Description",
    },
  };
  const res = response();

  await controller(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(cleanupCalls.length, 1);
  assert.doesNotMatch(
    JSON.stringify(res.body),
    /one\.mp4|uploads|database/i,
  );
});

test("upload middleware cleans partial files after Multer error", async () => {
  const cleanupCalls = [];

  const upload = {
    array(fieldName, maxCount) {
      assert.equal(fieldName, "S_content");
      assert.equal(maxCount, 2);

      return (req, res, callback) => {
        req.files = [{ filename: "partial.mp4" }];
        callback({ code: "LIMIT_FILE_COUNT" });
      };
    },
  };

  const middleware = createCourseVideoUploadMiddleware({
    upload,
    env: {
      MAX_SECTION_VIDEOS: "2",
      MAX_VIDEO_SIZE_MB: "50",
    },
    cleanupFiles: async (files) => {
      cleanupCalls.push(files);
      return { deleted: ["partial.mp4"], failed: [] };
    },
    logger: { warn() {} },
  });

  const req = {};
  const res = response();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(cleanupCalls.length, 1);
});
