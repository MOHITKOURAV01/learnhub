# Issue #43 — Course listing pagination and filters

The existing endpoint remains:

```text
GET /api/user/getallcourses
```

No frontend route or endpoint change is required.

## Query parameters

| Parameter | Behaviour |
|---|---|
| `page` | Positive integer, default `1` |
| `limit` | Positive integer, default `12`, maximum `100` |
| `search` | Case-insensitive title/description search |
| `category` | Exact case-insensitive category match |
| `educator` | Exact case-insensitive educator match |
| `priceType` | `free` or `paid` |
| `sort` | `newest`, `title`, or `enrollment` |

`enrolled` and `popular` are accepted aliases for enrollment sorting.

## Response compatibility

The existing `data` array is preserved:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 12,
    "totalItems": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

Current frontend consumers that read `response.data.data` continue to work.

## Search safety

Search text is escaped before being placed into a regular expression. For
example, `node.js` searches for a literal dot instead of using `.` as a regex
wildcard.

## Price classification

Existing course records may use:

```text
free
0
0.00
```

for free courses. The `free` filter recognizes those forms. `paid` requires a
present non-empty price that does not match the free pattern.

## Verification

```powershell
cd backend
npm install
npm test

node --check controllers/courseListingController.js
node --check utils/pagination.js
node --check utils/courseListing.js
node --check controllers/userControllers.js
```
