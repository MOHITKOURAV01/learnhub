const fs = require("fs/promises");
const path = require("path");

const DEFAULT_UPLOADS_DIRECTORY = path.resolve(__dirname, "..", "uploads");

function resolveUploadedFilePath(
  file,
  uploadsDirectory = DEFAULT_UPLOADS_DIRECTORY,
) {
  if (!file || typeof file.filename !== "string") return null;

  const filename = path.basename(file.filename.trim());
  if (!filename) return null;

  const root = path.resolve(uploadsDirectory);
  const candidate = path.resolve(root, filename);

  if (!candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

async function cleanupUploadedFiles(
  files,
  {
    uploadsDirectory = DEFAULT_UPLOADS_DIRECTORY,
    unlink = fs.unlink,
  } = {},
) {
  const deleted = [];
  const failed = [];

  for (const file of Array.isArray(files) ? files : []) {
    const filePath = resolveUploadedFilePath(file, uploadsDirectory);

    if (!filePath) {
      failed.push({
        filename:
          typeof file?.filename === "string"
            ? path.basename(file.filename)
            : "unknown",
        reason: "unsafe-file-reference",
      });
      continue;
    }

    try {
      await unlink(filePath);
      deleted.push(path.basename(filePath));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      failed.push({
        filename: path.basename(filePath),
        reason: "cleanup-failed",
      });
    }
  }

  return { deleted, failed };
}

module.exports = {
  DEFAULT_UPLOADS_DIRECTORY,
  cleanupUploadedFiles,
  resolveUploadedFilePath,
};
