const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  collectVideoFilenames,
  removeCourseVideoFiles,
  resolveSafeUploadPath,
} = require("../utils/courseFileCleanup");

test("collects unique basename-only video filenames", () => {
  const filenames = collectVideoFilenames({
    sections: [
      { S_content: { filename: "first.mp4" } },
      { S_content: { filename: "../second.mp4" } },
      { S_content: { filename: "first.mp4" } },
      {},
    ],
  });

  assert.deepEqual(filenames, ["first.mp4", "second.mp4", "first.mp4"]);
});

test("resolves files only inside uploads root", () => {
  const root = path.resolve("test-uploads");
  assert.equal(
    resolveSafeUploadPath("../video.mp4", root),
    path.join(root, "video.mp4"),
  );
  assert.equal(resolveSafeUploadPath("", root), null);
});

test("removes each unique local video once and ignores missing files", async () => {
  const calls = [];
  const result = await removeCourseVideoFiles(
    {
      sections: [
        { S_content: { filename: "one.mp4" } },
        { S_content: { filename: "one.mp4" } },
        { S_content: { filename: "missing.mp4" } },
      ],
    },
    {
      uploadsRoot: path.resolve("test-uploads"),
      unlink: async (filePath) => {
        calls.push(filePath);
        if (filePath.endsWith("missing.mp4")) {
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        }
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(result.deleted, ["one.mp4"]);
  assert.deepEqual(result.failed, []);
});
