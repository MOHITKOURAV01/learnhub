# Issue #44 — Secure MP4 course uploads

The endpoint remains:

```text
POST /api/user/addcourse
```

Validation now requires both `.mp4` extension and an expected MP4 MIME type.

Defaults:

```env
MAX_VIDEO_SIZE_MB=250
MAX_SECTION_VIDEOS=20
```

Oversized files return `413`. Invalid MIME/extension and file-count violations
return `400`. Error responses never include local filesystem paths.

Generated server filenames use:

```text
section-video-{timestamp}-{randomHex}.mp4
```

Already-written files are cleaned when Multer rejects a request or when course
creation fails after upload.

## Verification

```powershell
cd backend
npm install
npm test

node --check utils/videoUpload.js
node --check utils/uploadCleanup.js
node --check utils/courseVideoUploadMiddleware.js
node --check controllers/courseCreationController.js
node --check routers/userRoutes.js
node --check controllers/userControllers.js
```
