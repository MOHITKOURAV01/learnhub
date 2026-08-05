const fs = require("fs/promises");
const path = require("path");

const UPLOADS_ROOT = path.resolve(__dirname, "..", "uploads");

function collectVideoFilenames(course) {
  if (!Array.isArray(course?.sections)) return [];

  return course.sections
    .map((section) => section?.S_content?.filename)
    .filter((filename) => typeof filename === "string" && filename.trim())
    .map((filename) => path.basename(filename.trim()));
}

function resolveSafeUploadPath(filename, uploadsRoot = UPLOADS_ROOT) {
  const safeName = path.basename(filename);
  const resolvedRoot = path.resolve(uploadsRoot);
  const resolvedFile = path.resolve(resolvedRoot, safeName);

  if (
    resolvedFile === resolvedRoot ||
    !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    return null;
  }

  return resolvedFile;
}

async function removeCourseVideoFiles(
  course,
  {
    uploadsRoot = UPLOADS_ROOT,
    unlink = fs.unlink,
  } = {},
) {
  const deleted = [];
  const failed = [];
  const uniqueFilenames = [...new Set(collectVideoFilenames(course))];

  for (const filename of uniqueFilenames) {
    const filePath = resolveSafeUploadPath(filename, uploadsRoot);

    if (!filePath) {
      failed.push({ filename, reason: "unsafe-path" });
      continue;
    }

    try {
      await unlink(filePath);
      deleted.push(filename);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        continue;
      }

      failed.push({
        filename,
        reason: error instanceof Error ? error.message : "delete-failed",
      });
    }
  }

  return { deleted, failed };
}

module.exports = {
  UPLOADS_ROOT,
  collectVideoFilenames,
  removeCourseVideoFiles,
  resolveSafeUploadPath,
};
