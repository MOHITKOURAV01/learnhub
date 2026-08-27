# The admin payments endpoint (#104)

## The defect

`getAdminPaymentsController` accepted `page`, `limit`, `search`, `status` and
`sort`, and applied exactly one of them to the database:

```js
const records = await coursePaymentSchema
  .find(match)                                  // match held the date range, nothing else
  .select("_id userId courseId status createdAt updatedAt +cardDetails.cardnumber")
  .populate("userId", "name email")
  .populate("courseId", "C_title C_price")
  .lean();

let sanitizedPayments = records.map(buildSanitizedPayment);

if (search) { sanitizedPayments = sanitizedPayments.filter(...) }
if (status) { sanitizedPayments = sanitizedPayments.filter(...) }
sanitizedPayments.sort(sorters[sort]);

const paginatedPayments = sanitizedPayments.slice(startIndex, startIndex + limit);
```

No `skip`, no `limit`, no `sort` on the query. Search, status, ordering, the
summary totals and the slice all ran in Node over every payment row in the
collection, plus one `$in` lookup into `users` and one into `courses` for all of
them, to return at most fifty rows and by default ten.

A payment row is written on **every** enrolment, free courses included, by
`enrollCourseController` — so this is the admin table that grows fastest. It is
the same defect #96 fixed for the user and course lists.

Two things had genuinely resisted a plain `find()`, and both were worked around
in JS rather than solved:

- **Status.** `normalizeStatus()` maps five stored spellings onto three
  (`enrolled`, `paid` and `completed` are all *successful*). The filter is a
  property of the normalised value, not of the stored one, so it could not be
  matched directly.
- **Amount.** The number lives on the *joined* course as `C_price`, a free-form
  `String`. `parseAmount` ran a regex strip and a `parseFloat` for every row on
  every request — including when the sort had nothing to do with the amount.

### A second, quieter bug

```js
maskedCard: maskCardNumber(payment.cardDetails?.cardnumber),
```

#55 removed `cardnumber` from `coursePaymentModel` and stores
`cardDetails.cardLast4` instead. This line still read the removed field, so
**every payment written since #55 rendered a blank card column** in the
dashboard. Only rows predating that change showed anything.

## The fix

One aggregation. `$match` the date range on an indexed field → `$lookup` the
user and the course, projecting only the columns the table renders → `$addFields`
the normalised status and the numeric amount → `$match` search and status →
`$facet` the rows, the summary and the count.

### `backend/utils/paymentListing.js` (new)

| export | does |
| --- | --- |
| `parsePaymentQuery(query)` | validates page, limit, search, status, sort and the date range; reproduces every rejection message the old controller produced |
| `buildDateMatch(filters)` | the one filter that can run before the joins |
| `STATUS_EXPRESSION` | `$switch` folding the five stored spellings into three |
| `AMOUNT_EXPRESSION` | reads a number out of `C_price` — commas removed, first numeric run taken, `"free"` → `0` |
| `SEARCH_EXPRESSION` | the searchable text, keeping the old fallbacks so `"Deleted"` still finds orphaned rows |
| `buildPaymentSort(sort)` | the sort, always with an `_id` tiebreak |
| `buildPaymentPipeline(filters, collections)` | the whole pipeline |
| `buildSummary(buckets)` | folds the `$facet` buckets into the dashboard's block |
| `maskStoredCard(row)` / `maskCardNumber(value)` | `cardLast4` first, `cardnumber` for legacy rows |
| `toPaymentRow(row)` | shapes one projected row — over the page only |
| `readPaymentFacet(facet, filters)` | the `$facet` document → `{ data, summary, pagination }` |
| `clampedPage(filters, totalItems)` | the page to retry with when the request asked past the end |

### `backend/controllers/paymentRecordsController.js`

Now the HTTP edge: parse, build, run, respond. 267 lines down to 100.

`$lookup` needs a *collection* name, not a model, so the two are read off
`model.collection.name` rather than written as `"users"` and `"courses"`
literals — a change to Mongoose's pluralisation cannot silently make every join
return nothing.

## What else changed, and why

- **Stable page boundaries.** The old in-memory comparators had no tiebreak, so
  two payments sharing a timestamp — ordinary when a seed script or a burst of
  enrolments writes several in the same millisecond — could swap places between
  two requests and make a row appear on both page one and page two, or on
  neither. Every sort now ends in `_id`.
- **The summary is computed in the same pass as the rows**, inside the `$facet`,
  so the totals cannot drift from what is on screen.
- **Orphaned rows survive.** `$unwind` with `preserveNullAndEmptyArrays`, so a
  payment whose user or course was deleted still shows as an orphaned row
  instead of vanishing from the dashboard.
- **The card column works again**, per the second bug above.
- **An over-large page** is detected from the count and re-run once. The old code
  clamped by slicing an array it already had; an aggregation has skipped past the
  end before it knows the total. At most two round trips, and only when the
  client asked for a page that does not exist.

## What did not change

The response body. `data[]`, `summary`, `pagination` and `filters` keep the exact
shapes `frontend/src/components/admin/PaymentRecords.jsx` reads, every rejection
message is preserved verbatim, and the full card number is still never returned.
No frontend change was needed.

## Verifying

```bash
cd backend && npm test    # 358 pass (314 before, 44 added)
```

Against a large collection:

```js
const bulk = [];
for (let i = 0; i < 50000; i++) bulk.push({ userId, courseId, amount: "499", status: "enrolled", createdAt: new Date(), updatedAt: new Date() });
db.coursepayments.insertMany(bulk);
db.setProfilingLevel(2);
```

`db.system.profile` for a ten-row page now shows a `$limit` stage and
`docsExamined` on the order of the page, where it previously reported the whole
collection with no `limit` at all.

## Notes

- `escapeRegex` from `utils/courseListing` stays on the search path. The value
  goes into a `RegExp` and a bare `(` is enough to turn a search box into a 500;
  there is a test for exactly that.
- `coursePaymentModel` already indexed `{ createdAt: -1 }`,
  `{ userId: 1, createdAt: -1 }` and `{ courseId: 1, createdAt: -1 }`, so the
  date range and the default sort are covered. No new index was needed.
- `$replaceAll` (MongoDB 4.4+) and `$regexFind` (4.2+) are both well within what
  Mongoose 7 and the project's `mongodb-memory-server` provide.
