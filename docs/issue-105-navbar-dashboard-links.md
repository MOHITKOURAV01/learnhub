# The navbar's dashboard links (#105)

## The defect

`NavBar` drove the dashboard by calling a prop:

```jsx
const NavBar = ({ setSelectedComponent }) => {
   const handleOptionClick = (component) => {
      setSelectedComponent(component);
   };
   ...
   <NavLink className="premium-btn" onClick={() => handleOptionClick('addcourse')}>Add Course</NavLink>
   <NavLink className="premium-btn" onClick={() => handleOptionClick('cousres')}>Courses</NavLink>
   <NavLink className="premium-btn" onClick={() => handleOptionClick('enrolledcourese')}>Enrolled Courses</NavLink>
```

Only `Dashboard.jsx` passed that prop. `CourseContent.jsx` renders the same
component bare — `<NavBar />` — so on `/courseSection/:courseId/:courseTitle`,
the page a student spends the whole course on, `setSelectedComponent` was
`undefined` and every one of those three links threw

```
Uncaught TypeError: setSelectedComponent is not a function
```

on click. React Router's `Link` runs the caller's `onClick` **before** its own
click handling, so the throw also stopped the navigation. The link was simply
dead: nothing happened, and the user had no route out of the course player
except the brand or the address bar.

Two smaller problems sat in the same block:

- Those `<NavLink>` elements had **no `to`**. React Router resolves `undefined`
  against the current location, so they rendered as `<a href="/courseSection/…">`
  — a link pointing at the page you were already on. They could not be
  middle-clicked, opened in a new tab, bookmarked, or reached in any way that
  did not go through the broken `onClick`.
- `Home` was a raw anchor: `<a className="premium-btn" href="/dashboard">`.
  Inside a `BrowserRouter` that is a full document load, tearing down
  `AuthProvider`, `BookmarksProvider` and `ThemeProvider` and re-fetching
  everything, where a `<Link>` would not.

And the selection lived only in `useState`, so `/dashboard` could not address a
panel. Reloading while on Add Course dropped the user back to the catalogue, and
there was no URL for "the teacher's course list" to link to or share.

## The fix

Make the panel a URL concern. The navbar then navigates like any other link,
works on every page that renders it, and needs no prop at all.

### `frontend/src/lib/dashboardPanels.js` (new)

| export | does |
| --- | --- |
| `PANELS` | the canonical panel names |
| `PANEL_LINKS` | the panels the navbar offers, and who may see each — held as data |
| `normalizePanel(value)` | any spelling → a canonical name, `''` when unrecognised |
| `canSeePanel(panel, user)` | the role check, through `lib/roles` |
| `resolvePanel(value, user)` | the panel to render; unknown or not-permitted → `home` |
| `visiblePanelLinks(user)` | the links this account should see |
| `panelPath(panel)` | the address of a panel |
| `readPanelFromSearch(search)` | the panel out of a query string or `URLSearchParams` |

The navbar renders from `PANEL_LINKS` and the dashboard validates against it, so
the two cannot disagree about who may see what. They were previously two
separate lists of string literals that had to agree by hand.

The old names (`cousres`, `enrolledcourese`) are kept as **aliases** rather than
broken, so nothing has to be coordinated across a deploy.

### `frontend/src/components/common/NavBar.jsx`

- `setSelectedComponent` is gone. The component takes no props.
- The three role links become real `<Link to={panelPath(panel)}>` anchors,
  rendered from `visiblePanelLinks(user.userData)`.
- `Home` becomes a `<Link>`.

### `frontend/src/components/common/Dashboard.jsx`

- Reads the panel from `useSearchParams()` through `resolvePanel`.
- The role guards move into `canSeePanel`. The fallback behaviour is unchanged —
  an unknown panel, or one the account may not use, renders `<UserHome />`, which
  is what the old `default:` and the two inline guards did. It matters more now,
  because the value can be typed into the address bar rather than only arriving
  from a click.

### One piece of dead code removed

The old switch carried:

```js
case 'cousreSection':
   return <CourseContent />
```

Nothing could reach it. No caller ever set that name — `grep` for it finds only
the `case` — and `CourseContent` reads `:courseId` and `:courseTitle` from the
route, which `/dashboard` does not have, so it would have rendered a broken page
if anything had. It is gone rather than ported. The course player is reached at
`/courseSection/:courseId/:courseTitle`, exactly as before.

## Verifying

```bash
cd frontend && npm test    # 138 pass (112 before, 26 added)
cd frontend && npm run build
```

By hand:

1. Sign in as a teacher, open any course so you land on
   `/courseSection/<id>/<title>`, open the console, and click **Add Course**.
   You arrive at `/dashboard?panel=addcourse`. Before this change the console
   showed a `TypeError` and nothing moved.
2. Reload that URL → still the Add Course form.
3. Right-click **Add Course** → *Open link in new tab* → the form, in a new tab.
   Before, it opened the page you were already on.
4. Click **Home** → no full page reload; the providers stay mounted.
5. Sign in as a student and type `/dashboard?panel=addcourse` by hand → the
   student catalogue, not the educator's form.

## Notes

- `lib/dashboardPanels.js` imports `./roles.js` with the extension. Vite resolves
  either form, but `node --test` runs these modules as plain ESM and will not
  guess one.
- The role comparison still goes through `lib/roles`, which is where the
  "Teacher" vs "teacher" rule from #84 lives, so an account written before #55
  keeps working.
