# Theme (#97)

## The defect

### Dark mode did not exist for a signed-out visitor

`NavBar.jsx` was the only place in the application that ever touched the class:

```jsx
useEffect(() => {
   const isDark = localStorage.getItem('darkMode') === 'true';
   setDarkMode(isDark);
   if (isDark) { document.body.classList.add('dark-mode'); }
   else { document.body.classList.remove('dark-mode'); }
}, []);
```

and forty lines above it:

```jsx
if (!user?.userData) {
   return null
}
```

So `/`, `/login`, `/register`, `/privacy`, `/terms` and the 404 had no code
path that could put `dark-mode` on the body. A visitor who set dark mode,
signed out and came back to the landing page got a light page and no control to
change it — the toggle lived in a Settings dropdown only a signed-in user could
open.

### A white flash on every full load

The class was applied inside a `useEffect`, which runs after the first paint.
Every full load of a signed-in page rendered light and then repainted dark.

### The rest

- The preference was a third storage key alongside the two `AxiosInstance`
  owns, written as a boolean (`localStorage.setItem('darkMode', newMode)`) and
  read back as a string (`=== 'true'`). It worked by coercion.
- `prefers-color-scheme` was consulted nowhere, so a visitor whose OS is dark
  got a light page.
- The dropdown's other control wrote `document.body.style.filter =
  'brightness(1.2)'` inline. Not persisted, undone by the next full navigation,
  and it dimmed images along with everything else.

### What was *not* wrong

An earlier draft of the issue claimed the stylesheet did not hold up its end,
on the strength of `grep -c "dark-mode" App.css` returning 6. That was wrong
and the issue has been corrected. The first of those six is a token block
redefining eleven custom properties, and `App.css` resolves colour through
`var(--…)` in 118 places against 25 hardcoded hex values. The landing sections,
the catalogue cards and the dashboard chrome all read those tokens and convert
correctly. **The CSS needed almost nothing; the problem was entirely in when
and where the class was applied.**

## The fix

### `frontend/src/lib/theme.js` (new)

| function | does |
| --- | --- |
| `readStoredPreference(storage)` | `light` \| `dark` \| `system`, migrating the old `darkMode` boolean |
| `writeStoredPreference(pref, storage)` | persists, and retires the legacy key |
| `resolveTheme(pref, prefersDark)` | the theme actually in force |
| `applyTheme(theme, doc)` | writes it onto the document |
| `nextPreference(pref)` | light → dark → system → light |
| `describeNextPreference`, `themeIcon`, `themeLabel` | what the toggle says |

Every storage access is wrapped: a private window, a disabled store or a
sandboxed frame throws on `localStorage`, and a theme preference is not worth
taking the page down for.

`applyTheme` writes **two** places, and both matter:

- `html.dark-mode`, plus `data-theme` and `style.colorScheme` — this is what
  the pre-paint script can reach, and `color-scheme` is what makes native form
  controls and scrollbars follow the theme;
- `body.dark-mode` — what `App.css`, `PaymentRecords.css` and
  `ActivityLogs.css` are all keyed on. `document.body` is `null` when the
  inline script runs, so this one can only be set once React mounts.

### `frontend/index.html`

A small synchronous script in `<head>` reads the preference, resolves it
against `prefers-color-scheme`, and marks `<html>` before the first paint. It
duplicates a dozen lines of `lib/theme.js` on purpose: it has to run before any
module is loaded, so it cannot import them.

One accompanying rule in `App.css` is what that script is *for*:

```css
html.dark-mode { background-color: #121212; color-scheme: dark; }
html.dark-mode body { background-color: #121212; color: #eae6df; }
```

It paints the correct ground during the window between paint and mount, which
is where the flash used to live.

### `frontend/src/theme/`

`ThemeProvider` holds the preference for the whole application and subscribes
to the `prefers-color-scheme` media query, so changing the OS theme while the
tab is open changes the page without a reload — but only while the preference
is `system`, since an explicit choice should stay chosen. `themeContext.js` is
split out so a file does not export both a component and a hook, matching what
`AuthProvider` already does.

`ThemeToggle` is one control rendered in both navbars. It cycles
light → dark → system, and its label and `aria-label` describe **what it will
do next**, not what is currently set.

`App.jsx` mounts `ThemeProvider` outermost — outside `AuthProvider` — because
the theme applies to pages that render no navbar and have no session, which is
the whole of the first defect.

### Navbars

`NavBar` loses its local `darkMode` state, its `useEffect`, its
`localStorage` writes and the brightness hack, and renders `<ThemeToggle />`
inside the Settings dropdown under an *Appearance* heading. `PublicNavBar`
gains the same toggle, so the signed-out pages have one at all.

Three preferences, not two: `system` is the default and is the only setting
that can honour the OS and keep following it.

## Tests

`frontend/src/lib/theme.test.js` — 20 tests:

- only the three known preferences are accepted;
- the default is `system`, including for a missing storage;
- an unrecognised stored value falls back to `system` rather than being trusted;
- **the old `darkMode` key is carried over in both directions**, and the new
  key wins when both are present;
- writing retires the legacy key;
- an invalid preference is not written;
- **a storage that throws does not take the page down** — read and write both;
- an explicit choice overrides the system in both directions;
- `system` follows `prefers-color-scheme`;
- applying dark sets the class, `data-theme` and `color-scheme` on the root and
  the class on the body; applying light removes all of it;
- **applying works with no `<body>`, which is the pre-paint case**, and with no
  document at all;
- the cycle order, the next-action wording, the icon and the label.

78 frontend tests passing, up from 73.

## Verifying by hand

1. Sign in, open Settings → the toggle. The dashboard goes dark.
2. Click Home → a full reload, and no white flash. On `main` this flashes light
   before repainting.
3. Sign out. **The landing page is dark**, and there is a toggle in the public
   navbar. On `main` it is light with no control anywhere.
4. `/login` and `/register` — dark, with the toggle.
5. Cycle the toggle to *System*, set the OS to dark, and watch the page follow
   without a reload.
6. In devtools, `localStorage.clear()`, set `darkMode` to `"true"`, reload →
   dark, and `localStorage.getItem('theme')` reads `"dark"` after the first
   toggle. The old preference is not lost.
7. Open a private window with the OS set to dark → dark, first paint.
