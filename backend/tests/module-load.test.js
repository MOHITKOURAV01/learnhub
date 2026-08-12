const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// A syntax error reached `main` in a8a16ab and stayed there because no test
// loaded the affected module directly. These tests parse and require every
// backend source file so a broken merge fails fast instead of at boot time.

const BACKEND_ROOT = path.join(__dirname, "..");

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "uploads",
  "tests",
  ".git",
]);

// Requiring these has side effects we do not want during a unit test run:
// index.js opens a Mongo connection and binds a port, seed.js writes data.
const REQUIRE_EXCLUDED = new Set(["index.js", "seed.js", "config/connect.js"]);

function collectSourceFiles(directory, relativeBase = "") {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = relativeBase
      ? `${relativeBase}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;

      files.push(
        ...collectSourceFiles(
          path.join(directory, entry.name),
          relativePath,
        ),
      );
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

const sourceFiles = collectSourceFiles(BACKEND_ROOT);

test("the backend has source files to check", () => {
  assert.ok(
    sourceFiles.length > 20,
    `expected to discover the backend sources, found ${sourceFiles.length}`,
  );
});

test("every backend source file parses", () => {
  const failures = [];

  for (const relativePath of sourceFiles) {
    try {
      execFileSync(
        process.execPath,
        ["--check", path.join(BACKEND_ROOT, relativePath)],
        { stdio: "pipe" },
      );
    } catch (error) {
      const details = String(error.stderr || error.message)
        .split("\n")
        .find((line) => line.includes("Error"));

      failures.push(`${relativePath}: ${details || "failed to parse"}`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    `these files do not parse:\n${failures.join("\n")}`,
  );
});

test("every controller, router, middleware and schema can be required", () => {
  const loadable = sourceFiles.filter(
    (relativePath) => !REQUIRE_EXCLUDED.has(relativePath),
  );

  const failures = [];

  for (const relativePath of loadable) {
    try {
      require(path.join(BACKEND_ROOT, relativePath));
    } catch (error) {
      failures.push(`${relativePath}: ${error.message}`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    `these files could not be required:\n${failures.join("\n")}`,
  );
});

test("the express app can be constructed without a database connection", () => {
  const app = require("../app");

  assert.equal(typeof app, "function", "app.js should export an express app");
  assert.equal(
    typeof app.listen,
    "function",
    "the exported app should be listenable",
  );
});

test("no source file contains unresolved merge conflict markers", () => {
  const offenders = [];

  for (const relativePath of sourceFiles) {
    const contents = fs.readFileSync(
      path.join(BACKEND_ROOT, relativePath),
      "utf8",
    );

    const hasMarker = contents
      .split("\n")
      .some(
        (line) =>
          line.startsWith("<<<<<<< ") ||
          line.startsWith(">>>>>>> ") ||
          line === "=======",
      );

    if (hasMarker) offenders.push(relativePath);
  }

  assert.deepEqual(offenders, [], "unresolved conflict markers found");
});
