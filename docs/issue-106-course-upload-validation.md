# Section video validation on the Add Course form (#106)

## The defect

The form and the API disagreed about what a section video is.

`frontend/src/components/user/teacher/AddCourse.jsx`:

```jsx
<Form.Label>Section Content (Video or Image)</Form.Label>
<Form.Control name="S_content" type="file" accept="video/*,image/*" required />
```

`backend/utils/videoUpload.js`:

```js
function isAllowedMp4File(file) {
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  const mimeType = String(file.mimetype || "").toLowerCase();
  return extension === ".mp4" && ALLOWED_MP4_MIME_TYPES.has(mimeType);
}
```

`.mp4` with a `video/mp4` or `application/mp4` type, and nothing else — the rule
#44 deliberately tightened. The picker offered every video format and every
image format, and the label told the teacher images were fine. A `.mov`, a
`.webm`, a `.mkv` or a `.png` was accepted by the form, uploaded in full, and
rejected by Multer's `fileFilter` at the end.

Size and count had the same shape. The server enforces `MAX_VIDEO_SIZE_MB` (250
by default) per file and `MAX_SECTION_VIDEOS` (20) per course, and
`mapUploadError` returns a specific 413 or 400 for each. The form checked
neither before sending, so a teacher with eight 300 MB lectures uploaded 2.4 GB
and was told at the end that one file was too big — without being told which
one. On a 10 Mbit connection that is roughly half an hour of waiting to be told
no.

The failure was also all-or-nothing. `handleSubmit` builds one `FormData` for
the whole course, so a single bad file discarded the entire submission — and the
form was left populated but with every `<input type="file">` empty, because a
file input cannot be repopulated programmatically. Every valid video had to be
picked again.

## The fix

Mirror the server's rules on the client, and refuse a file against the section
it belongs to at the moment it is chosen.

This duplicates a **constant**, not a security boundary. The check in
`backend/utils/videoUpload.js` is untouched and stays authoritative; a
deployment that lowers `MAX_VIDEO_SIZE_MB` still rejects what the browser let
through, which is the right way round.

### `frontend/src/lib/courseUpload.js` (new)

| export | does |
| --- | --- |
| `VIDEO_ACCEPT_ATTRIBUTE` | what the picker should offer: `.mp4,video/mp4` |
| `uploadLimits(overrides)` | the limits, with the server's defaults filled in |
| `fileExtension(name)` | lowercase extension, handling dotted and extensionless names |
| `isAllowedVideoType(type)` / `isAllowedVideoFile(file)` | the same extension-**and**-type pair the API checks |
| `describeFileProblem(file, limits)` | why this file cannot be uploaded, naming the file |
| `validateSection(section, limits)` | field → message for one section |
| `validateCourseUpload(course, limits)` | per-section errors plus a form-level message |
| `buildCourseFormData(course)` | the multipart body, keeping the three repeated fields aligned |
| `formatFileSize(bytes)` / `describeUploadRules(limits)` | the human-readable halves |

An **empty MIME type is not a pass**. A browser leaves it blank for an extension
it does not recognise, and the API rejects a blank `mimetype` outright, so
treating blank as unknown keeps the two answers the same.

### `frontend/src/components/user/teacher/AddCourse.jsx`

- `accept={VIDEO_ACCEPT_ATTRIBUTE}` — the picker offers only what the API takes.
- The label reads **Section Video (.mp4)**. It said "Video or Image".
- A rejected file is refused *on selection*, against that section, with the
  reason and the file's name. The input is cleared so it cannot be submitted and
  so the same file can be picked again after being converted.
- Valid files show their name and size underneath.
- Sections are numbered in their labels, and errors render through
  `Form.Control.Feedback` on the field that is actually wrong.
- The Add Section button disables at the limit, with a running
  `n / 20 sections` count. The 21st section used to be rejected only after all
  21 uploads finished.
- `describeUploadRules()` states the rule above the sections, before a file is
  picked rather than only after one is rejected.
- Removing a section re-keys the error map, so errors move with the sections
  instead of pointing at whatever ended up at that index.

## Verifying

```bash
cd frontend && npm test    # 143 pass (112 before, 31 added)
cd frontend && npm run build
```

By hand:

1. Dashboard → Add Course, add a section, open the picker.
   Only `.mp4` files are selectable, and the label says so.
2. Force a `.mov` through (drag-and-drop, or "All files" where the platform
   offers it) → refused immediately, under **that** section, naming the file. No
   upload starts.
3. Attach a file over 250 MB → refused immediately, showing both its size and
   the limit. Previously this uploaded to completion before the 413.
4. Fill two sections correctly, break the second, submit → the error names
   *Section 2*, and section 1's video is **still attached**. Previously the whole
   submission was lost and both inputs were emptied.
5. Add 20 sections → the Add Section button disables and the counter reads
   `20 / 20`.

## Notes

- This is a frontend-only change. Nothing in `backend/` moved.
- `describeFileProblem` checks extension **and** type because
  `isAllowedMp4File` does. Checking one alone lets `x.mp4` with an `image/png`
  type through the browser and into a server rejection, which is the failure
  this is meant to remove.
- `buildCourseFormData` appends `S_content`, `S_title` and `S_description`
  together per section, in order. The server pairs each uploaded file with the
  title and description at the same **position** — position is the only thing
  tying them together — and there is a test asserting the three stay aligned.
