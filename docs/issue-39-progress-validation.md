# Issue #39: course progress validation

## Behaviour

`POST /api/user/completemodule` now:

1. Requires `courseId` and `sectionId`.
2. Validates the MongoDB course ID.
3. Loads the course and verifies that the section belongs to it.
4. Uses the authenticated user's identity to verify enrollment.
5. Uses one conditional `$addToSet` update.
6. Returns `alreadyCompleted: true` when the same request is repeated.

## Section IDs

The current frontend sends the zero-based section index. The controller preserves
that API contract and also accepts an embedded section `_id`/`id` when one is
available in future course data.

## Atomicity

The update filter includes:

```js
"progress.sectionId": { $ne: normalizedSectionId }
```

and the update uses:

```js
$addToSet: { progress: { sectionId: normalizedSectionId } }
```

MongoDB reevaluates the filter when applying concurrent updates, so only one
request can add a given section completion.

## Test

```powershell
cd backend
npm install
npm test
```
