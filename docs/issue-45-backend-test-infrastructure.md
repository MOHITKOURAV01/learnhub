# LearnHub Issue #45 — Backend API Test Infrastructure

This patch adds a real Node.js test suite using Node's built-in test runner, Supertest, and an isolated `mongodb-memory-server` instance.

## Files

- `backend/app.js` — Express application without `listen()` or database startup.
- `backend/index.js` — production entry point; connects to MongoDB and starts the listener.
- `backend/config/connect.js` — async database connection.
- `backend/tests/setup.js` — isolated in-memory MongoDB lifecycle and per-test cleanup.
- `backend/tests/auth.test.js` — authentication/protected-route smoke tests.
- `backend/tests/courses.test.js` — course-route smoke tests.
- `backend/package.json` — test scripts and test dependencies.

## Install

From `backend/`:

```powershell
npm install
```

## Run tests

```powershell
npm test
```

The test runner exits with code 0 only when every test passes.

## Run watch mode

```powershell
npm run test:watch
```

## Production server

The normal server flow remains:

```powershell
npm start
```

`index.js` is now the only file responsible for opening the network listener.

## Isolation

Tests use `MongoMemoryServer`. They do not use the development `MONGO_URI`, and each test clears all MongoDB collections before it runs.

The test database is stopped and disconnected in the suite teardown.

## Important

The repository's current registration controller does not have a dedicated validation layer: a completely empty registration request reaches Mongoose validation and is returned as the existing `500` JSON error. The smoke test deliberately verifies that existing behavior rather than changing application validation scope in Issue #45.
