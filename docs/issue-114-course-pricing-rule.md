# One rule for "free" (#114)

## The defect

Whether a course costs money was asked in four places and answered three
different ways.

| where | rule |
| --- | --- |
| `utils/courseListing.js` | `/^\s*(?:free\|0(?:\.0+)?)\s*$/i` |
| `utils/paymentDetails.js` | `new Set(["", "0", "free"])` |
| `utils/bookmarkListing.js` | any digit anywhere means paid |
| `frontend/src/lib/catalogQuery.js` | a copy of the first, with a different answer for `""` |

They disagree on half of a small sample of realistic prices:

```
price        catalogue checkout wishlist
"free"       true      true     true
"0"          true      true     false   <-- DISAGREE
"0.00"       true      false    false   <-- DISAGREE
"0.0"        true      false    false   <-- DISAGREE
""           false     true     true    <-- DISAGREE
"  0.00 "    true      false    false   <-- DISAGREE
"499"        false     false    false
```

Three user-visible failures, one per disagreeing row.

**`"0.00"` — the course could not be enrolled in at all.** The card rendered
`ACCESS: Free`, so `handleEnroll` took the free branch and never opened the
payment modal:

```js
if (!isPaidCourse(course)) {
  handleSubmit(course._id, course.C_title);
  return;
}
```

`handleSubmit` posted the untouched `cardDetails` state — four empty strings —
and the server, following the middle column, rejected it:

```json
{ "success": false,
  "message": "Cardholder name is required. Card number is not valid. ..." }
```

The learner saw none of that, because the catch discarded it:

```js
alert("Enrollment could not be completed. Please try again.");
```

There was no route to the payment form, because the UI did not believe there
was anything to pay. Retrying produced the same alert forever.

**`"0"` — the catalogue and the wishlist contradicted each other.** `Free` on
the catalogue card, `Paid` on the wishlist card for the same course, and the
wishlist's Free filter hid it.

**`""` — a blank price was billed.** The client rule was inconsistent with
itself: `undefined` and `null` returned early as free, while `""` fell through
to the pattern and came out paid. The card rendered `ACCESS:` followed by
nothing and opened a payment form for a course the server records as
`amount: "free"` and never charges for.

## The fix

One rule, stated twice — once per side of the wire — with the same table
asserted on both.

### `backend/utils/coursePricing.js` (new)

| export | does |
| --- | --- |
| `FREE_PRICE_PATTERN` | `/^\s*(?:free\|0+(?:\.0+)?)\s*$/i` — repeated leading zeros now count too |
| `isFreePrice` / `isPaidPrice` | the rule, over a raw `C_price` |
| `isFreeCourse` / `isPaidCourse` | the same, over a document |
| `normalizeCoursePrice` | the write rule, moved here from `courseInput` |
| `formatPriceLabel` | `"Free"`, or the price |
| `freePriceFilterClauses` / `paidPriceFilterClauses` | the `find` filter |
| `accessTypeExpression(path)` | the same rule as an aggregation `$cond` |

`frontend/src/lib/coursePricing.js` mirrors it, and adds
`readEnrollmentError` / `readEnrollmentFieldErrors`.

### The call sites

- **`utils/paymentDetails.js`** — `isFreeCourse` delegates. This is the gate
  that decides whether money is asked for, so it is the one that must not have
  an opinion of its own.
- **`utils/courseInput.js`** — `normalizeCoursePrice` delegates. The write rule
  and the read rule are now literally the same function.
- **`utils/courseListing.js`** — re-exports the pattern and builds the filter
  from the shared clauses.
- **`utils/bookmarkListing.js`** — `ACCESS_EXPRESSION` is
  `accessTypeExpression("$course.C_price")`.
- **`frontend/src/lib/catalogQuery.js`** — re-exports `isPaidCourse` and
  `coursePriceLabel`, so `AllCourses` did not have to change its import.

## Two decisions worth stating

### A blank price is free

Rather than paid, which is what the catalogue said. That is what the server
already charges for it, and the alternative — asking for a card number to enrol
in a course nobody will be charged for — is the worse of the two mistakes.

`catalogQuery.test.js` had a line asserting the old behaviour. It is now
inverted, with a comment saying so, next to a new test naming the change.

### The wishlist rule is tightened, and that is a behaviour change

`bookmarkListing.js` carried an explicit comment that its loose `/[0-9]/` test
was kept deliberately, because tightening it moves courses between the Free and
Paid filters on wishlists people have already saved.

That reasoning held while there was nothing to move towards. There is now, and
the looseness was not harmless: a course priced `"0"` read `Free` on its
catalogue card and `Paid` on the wishlist card beside it.

**So it is aligned, and the effect is real: a saved course whose price reads as
zero moves from Paid to Free.** It moves onto the label the catalogue has always
shown it under, which is the point. `accessType` is computed on read and nothing
is stored per bookmark, so there is no migration — and no way for the two to
drift apart again.

## The filter shape had to change

The free side used to be one `C_price: { $regex }`. A regex cannot match a
field that does not exist, and an absent price is free, so it is an `$or` over
four clauses now. It is also nested under `$and` rather than assigned to
`C_price` directly, so a search term's own `$or` is not clobbered — searching
"css" restricted to free courses is no longer silently widened to every free
course. There is a test for that.

`course-listing.test.js` had one test reading the pattern off the filter's
shape. It asserts what the filter *selects* instead; every value it already
covered is selected identically.

## The rejected enrolment is now legible

`AllCourses.jsx` reads the response instead of discarding it. The sentence goes
in a `.payment-error` banner inside the modal, the per-field `errors` map marks
the inputs it names with `aria-invalid` and a message underneath, and each
marker clears as soon as that input is edited. The modal stays open so the
field can be corrected. A free course has no modal, so it still gets the alert —
with the server's message rather than a fixed one.

`--danger`, `--danger-soft` and `--danger-border` are defined in both the light
and the `body.dark-mode` blocks. The palette had no error colour at all, which
is some of why an error had nowhere to go but an `alert()`.

## Tests

- **`backend/tests/course-pricing.test.js`** (new, 19). The table, then each
  call site asserted against it: checkout, the `find` filter, the paid filter as
  its exact complement, and the aggregation pattern. `$regexMatch` takes a
  string rather than a `RegExp`, so the rule is spelled twice in the backend
  too — one test compiles the string form and runs the whole table through it.
- **`frontend/src/lib/coursePricing.test.js`** (new, 14). The same table,
  character for character, plus the label and the error readers. Nothing can
  import across the wire, so this duplication is the mechanism keeping the two
  halves together.
- **`course-listing.test.js`** — the shape test rewritten, plus two new ones for
  the absent-price clause and the search interaction.
- **`catalogQuery.test.js`** — the `""` assertion inverted, with a test naming
  the change.

## Verifying

```bash
cd backend  && npm test    # 434 pass (413 before, 21 added)
cd frontend && npm test    # 183 pass (169 before, 14 added)
cd frontend && npm run build
```

The reported bug, end to end:

```js
db.courses.updateOne({ C_title: "Intro to CSS" }, { $set: { C_price: "0.00" } })
```

Before: the card says `Free`, Enroll opens no modal, and the alert says to try
again. After: the card says `Free`, Enroll succeeds, and the payment record
carries `amount: "free"`.

## Notes

- `npm run lint` in `frontend/` does not pass on `main` and does not pass here.
  The 5 errors reported on `AllCourses.jsx` are the same 5 before and after this
  change — an unused `React` import and four `react/prop-types` on the existing
  `CourseArtwork`. `lib/coursePricing.js` and `lib/catalogQuery.js` lint clean.
- A price like `"$0"` or `"₹0.00"` is still classified paid. Tightening the rule
  to strip currency symbols is a bigger change with more ways to be wrong, and
  `normalizeCoursePrice` collapses these on write, so the exposure is legacy
  rows only. Left deliberately, and covered by a test asserting `"$29"` is paid.
- The payment form's own input constraints are untouched. `maxLength="3"` on the
  CVV against a validator accepting 3–4 is a real problem, and a separate one.
