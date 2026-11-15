# Accessibility review

Scope: the web client in `packages/web`, which renders every screen of the
dashboard. Review date: 15 November 2026. Target level: WCAG 2.2 AA.

## Method

1. Manual source review of every component under `packages/web/src/ui` and of
   `packages/web/src/styles/index.css`.
2. Computed contrast ratios for every foreground/background pair in the theme,
   including the row-hover and selected-row backgrounds and the translucent
   badge fills.
3. The automated browser checks that already run in `pnpm test:e2e`:
   - E2E-10: keyboard-only filtering, opening a record and closing it with
     `Escape`, then confirming focus returns to the originating row.
   - E2E-13: every network request stays on the application origin.
   - E2E-14: with `prefers-reduced-motion: reduce`, no transition or animation
     runs.
4. Manual outline review: one `h1`, no skipped heading levels, every section and
   table named, every form control labelled.

No third-party accessibility scanner is run. `BUILD_SPEC.md` section 1 pins the
dependency list and does not include an axe or similar package, so this review is
a source review plus the checks above. Adding a scanner is a product decision,
not an implementation detail.

## Findings and fixes

| Finding | Criterion | Fix |
|---|---|---|
| No `h1` on any screen; panel titles were `<div>` and `<span>` text | 1.3.1, 2.4.6 | Added a visually hidden `h1` ("Kubernetes Events Explorer") to the shell; panel titles are now `h2` and detail sections `h3` |
| Heading levels jumped inside the detail panel and analytics sections | 2.4.6 | Headings now run `h1`, `h2`, `h3` in document order |
| No bypass mechanism past the header and cluster selector | 2.4.1 | Added a "Skip to main content" link that is visible on keyboard focus and targets `#main-content` |
| `aria-label` on plain `div` elements ("Event filters", "Additional filters") is not exposed to assistive technology | 1.3.1, 4.1.2 | Both containers are now `role="group"` with the same accessible name |
| Accessible names overrode the visible label ("From (UTC)" vs "Custom range start", "Object name" vs "Resource name filter") | 2.5.3 | Removed the redundant `aria-label` attributes so the visible `<label>` is the accessible name |
| `--color-text-muted` (`#64748b`) measured 3.07:1 on the card surface and 3.75:1 on the page background, used for 0.75rem labels | 1.4.3 | Muted text is now `#94a3b8` (5.71:1 on surface, 6.96:1 on background) |
| Secondary text measured 4.04:1 on the row-hover background | 1.4.3 | Row hover is now `#26344a`; secondary text is `#b0bccd` (6.53:1 on hover) |
| `--color-danger` (`#ef4444`) measured 3.89:1 on the card surface for small text | 1.4.3 | Danger text is now `#f87171` (5.29:1 on surface, 4.54:1 on hover, 4.55:1 on a selected row) |
| The selected-row overlay made muted text 3.58:1 | 1.4.3 | The overlay is `rgba(50, 108, 229, 0.15)`; muted text is 4.91:1 there |
| The timestamp column rendered a cryptic `[inv]` marker with only a `title` tooltip | 1.3.1, 1.4.1 | The abbreviation is `aria-hidden` and an "invalid or missing timestamp" string is exposed to assistive technology |
| Filter, chip and pager buttons relied on the default submit type | 4.1.2 | All buttons declare `type="button"` |
| Page title named the retired product ("Kubernetes Events Filter Dashboard") | 2.4.2 | Title is now "Kubernetes Events Explorer" |

### Measured contrast after the fixes

Foreground on page background, card surface, row hover (`#26344a`) and selected
row (`#213355`):

| Foreground | Background | Ratio |
|---|---|---:|
| Text primary `#f8fafc` | all four | 12.02 - 17.06 |
| Text secondary `#b0bccd` | all four | 6.53 - 9.28 |
| Text muted `#94a3b8` | all four | 4.90 - 6.96 |
| Normal `#10b981` | all four | 4.95 - 7.04 |
| Warning `#f59e0b` | all four | 5.85 - 8.31 |
| Danger `#f87171` | all four | 4.54 - 6.45 |
| Focus ring `#60a5fa` | all four | 4.94 - 7.02 |
| Primary button label `#ffffff` | button fill `#326ce5` | 4.76 |

The lowest ratio in the product is 4.54:1 for danger text on a hovered row;
every text pair meets the 4.5:1 AA floor without relying on large-text
exceptions.

## What already met AA

- Real `<table>` with `scope="col"` headers, `aria-sort`, a caption and
  keyboard-operable sort buttons. The scroll container is a focusable,
  named `region`.
- Every chart has an equivalent data table with row headers and a button per
  value, so charts are never the only route to the numbers.
- Normal/Warning, cluster status and validation state are always carried by
  text, not colour alone.
- Form controls are labelled; the result count uses `aria-live="polite"` while
  arriving rows are not announced.
- The detail panel is a native `<dialog>` opened with `showModal()`, so focus is
  contained, `Escape` closes it, and focus returns to the originating row or the
  explorer's primary control.
- `prefers-reduced-motion: reduce` disables all transitions and animations.
- Narrow layouts keep filters, fields and the detail panel reachable; the event
  table scrolls horizontally inside its named region.

## Known limitations

- No automated accessibility scanner runs in CI (see Method).
- Chart bar and pie fills are compared against the surrounding surface at
  3.07:1 or better, but individual palette colours in the namespace chart are
  not all 3:1 against each other; the accompanying table is the accessible
  equivalent.
- Zoom to 400% was checked by resizing the viewport, not with a screen reader or
  with browser text spacing overrides beyond the default stylesheet.
- No screen-reader session is part of the recorded gate; findings above come
  from source review, computed contrast and the automated browser checks.
