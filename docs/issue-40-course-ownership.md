# Issue #40 — Course deletion ownership

## Security behaviour

`DELETE /api/user/deletecourse/:courseid` now applies these rules:

| Authenticated role | Course owner | Result |
|---|---:|---|
| Teacher | Same authenticated teacher | `200` |
| Teacher | Another teacher | `403` |
| Admin | Any teacher | `200` |
| Teacher/Admin | Missing course | `404` |
| Teacher/Admin | Invalid MongoDB ID | `400` |

Ownership is read only from `req.user`, which is populated by the authentication
middleware. `req.body.userId` is deliberately ignored.

## Local video cleanup

After the MongoDB document is deleted, the controller attempts to remove video
files referenced by `sections[].S_content.filename`.

Cleanup is constrained to the backend `uploads` directory:

- `path.basename()` removes directory components.
- Resolved paths must remain under the uploads root.
- Duplicate filenames are removed once.
- Missing files are ignored.
- Other cleanup failures are logged and returned only as counts.
- Internal filesystem paths are not returned to clients.

## Verification

```powershell
cd backend
npm install
npm test

node --check controllers/courseDeletionController.js
node --check utils/courseFileCleanup.js
node --check routers/userRoutes.js
```
