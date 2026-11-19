# Dashboard v2: design system

Part of the dashboard v2 design ([README](README.md)). It replaces the weather-derived tokens and the light-only
rule of the first design system. The Verdify identity stays: the greens, the dark ink, IBM Plex Sans and IBM Plex
Mono (self-hosted; the content security policy allows no external font, script or inline style).

## 1. Rules

- A colour appears in a stylesheet or a component only as a token. The token files are the one place a colour
  literal may stand.
- Every colour token has a light and a dark value. Dark is chosen, not derived: each value below was checked for
  contrast on its own surfaces.
- No inline `style` attribute (the policy is `style-src 'self'`). Geometry that depends on data goes through CSS
  custom properties set with `cssVars()` (`components/data/viz.tsx`).
- Status colours (ok, warn, serious, critical, info) mean state and nothing else, and never stand alone: a status
  always carries an icon or a word.
- Motion is short (120 to 200 ms), never carries meaning, and stops under `prefers-reduced-motion`.
- Touch targets are at least 44 by 44 px. Text is never smaller than 12 px; inputs are 16 px so a phone does not zoom.

## 2. Tokens

All tokens live in `dashboard/app/styles/tokens.css`. Light is the default; dark applies under
`:root[data-theme="dark"]` and, when no theme is chosen, under `@media (prefers-color-scheme: dark)` on
`:root:not([data-theme="light"])`. The two dark blocks are identical, and a test says so. `color-scheme` follows
the theme.

### 2.1 Surfaces, text and accent

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f4f6f5` | `#0a1317` | Page |
| `--surface` | `#ffffff` | `#111c22` | Cards, dialogs, inputs |
| `--surface-2` | `#edf1ef` | `#17262d` | Insets, table heads, hover |
| `--surface-3` | `#e1e8e4` | `#1f323b` | Tracks, pressed, selected |
| `--border` | `#d9e2de` | `#22343d` | Hairlines |
| `--border-strong` | `#b3c3bb` | `#3a525d` | Dividers that must be seen |
| `--control-border` | `#6f867d` | `#6d8791` | Input and button outlines (3:1) |
| `--text` | `#0f1f2b` | `#e9eff1` | Primary text |
| `--text-2` | `#44525d` | `#b4c1c8` | Secondary text |
| `--text-3` | `#5d6a75` | `#93a2ab` | Labels, captions, axis text |
| `--accent` | `#0e5a43` | `#6fd8ad` | Links, primary buttons, selection |
| `--accent-hover` | `#0a4533` | `#8fe5c2` | Hover of the above |
| `--on-accent` | `#ffffff` | `#05241a` | Text on accent and on critical fills |
| `--accent-soft` | `#e2f2eb` | `#11352b` | Selected rows, soft buttons |
| `--accent-text` | `#0b4a37` | `#8fe5c2` | Text on accent-soft |
| `--focus` | `#0e5a43` | `#8fe5c2` | Focus ring (3 px, 2 px offset) |
| `--rail` | `#0f1f2b` | `#070e11` | Navigation rail |
| `--rail-text` | `#c3cfd6` | `#b4c1c8` | Rail links |
| `--rail-muted` | `#8c9ca6` | `#7f909a` | Rail group labels |
| `--rail-active` | `#17624b` | `#17402f` | The current section |
| `--rail-active-text` | `#ffffff` | `#ffffff` | Its text |
| `--hero` | `#102330` | `#132028` | The Now hero |
| `--hero-text` | `#ffffff` | `#ffffff` | Hero text |
| `--hero-text-2` | `#b9c6cd` | `#b4c1c8` | Hero secondary text |
| `--hero-accent` | `#7de2b8` | `#7de2b8` | Hero accent |
| `--hero-warn` | `#e5b23f` | `#e5b23f` | A reading outside the band, in the hero's text (the hero is dark in both themes) |
| `--scrim` | `rgb(15 31 43 / 45%)` | `rgb(0 0 0 / 60%)` | Behind dialogs and sheets |

### 2.2 Status

Each status has a solid (icons, dots, borders, fills behind `--on-accent` text), a soft background and a text
colour for that background.

| Status | Solid light / dark | Soft light / dark | Text light / dark |
|---|---|---|---|
| ok | `#17714f` / `#5fcf9f` | `#e2f2eb` / `#11352b` | `#0b4a37` / `#8fe5c2` |
| warn | `#a56a00` / `#e5b23f` | `#fbefd2` / `#3a2d0c` | `#5c4407` / `#f3cf7a` |
| serious | `#b4480c` / `#f08a4b` | `#fde9dc` / `#3d2313` | `#7a2f06` / `#f8b48a` |
| critical | `#b3261e` / `#f0736a` | `#fbeae8` / `#401b19` | `#8c1c16` / `#f8aaa4` |
| info | `#1f5fa8` / `#6aa9ee` | `#e4eefb` / `#13294a` | `#17467c` / `#a4c8f5` |
| neutral | `#5d6a75` / `#93a2ab` | `#edf1ef` / `#17262d` | `#44525d` / `#b4c1c8` |

Token names: `--ok`, `--ok-soft`, `--ok-text`, and the same three for `warn`, `serious`, `critical`, `info` and
`neutral`. A manual hold uses `info`.

### 2.3 Chart colours

A colour follows the thing it stands for in every chart and every theme. Each set below passed the palette
validator (lightness band, chroma, colour-vision separation of neighbours, normal-vision separation, contrast)
on `--surface` and on `--bg` in its theme.

| Token | Light | Dark | Stands for |
|---|---|---|---|
| `--c-temp` | `#0f1f2b` | `#e9eff1` | The house reading on a temperature chart, and any single measured line |
| `--c-vpd` | `#7d3ab7` | `#9e66f8` | VPD |
| `--c-rh` | `#0b84c9` | `#26a2bf` | Relative humidity |
| `--c-outdoor` | `#8a7a64` | `#9c8a70` | Outdoor, always dashed and labelled; the forecast is the same colour, dotted |
| `--c-band-wash` | `#dcebe4` | `#17342c` | The band's area |
| `--c-band-edge` | `#5f9485` | `#4f8f7c` | The band's low and high lines |
| `--c-grid` | `#e3e9e6` | `#1d2d35` | Grid lines |
| `--c-requested` | `#a56a00` | `#e5b23f` | A value asked for and not yet confirmed |
| `--eq-heat1` | `#c97400` | `#b68b16` | Electric heat; electricity |
| `--eq-heat2` | `#b61f02` | `#ca4459` | Gas heat; gas |
| `--eq-fan1` | `#12947f` | `#20a89b` | Fan 1 |
| `--eq-fan2` | `#4b55b5` | `#8976cd` | Fan 2 |
| `--eq-vent` | `#7f8f16` | `#81880e` | Vent |
| `--eq-fog` | `#1695c4` | `#209ae6` | Fog |
| `--eq-mister` | `#a3279e` | `#9d619b` | Misters; wetting water |
| `--eq-light-main` | `#4d9f45` | `#4fa83e` | Main light |
| `--eq-light-grow` | `#2855ad` | `#3987e5` | Grow light |
| `--eq-water` | `#2389e2` | `#297cef` | Water lines; irrigation water |
| `--eq-fert` | `#6331a0` | `#a57fc6` | Fertilised lines |
| `--eq-master` | `#0e9580` | `#219576` | Fertiliser valve |
| `--cmp-in` | `#3f9a78` | `#5da56e` | Time inside the band |
| `--cmp-below` | `#2f6fb5` | `#3082f6` | Time below the band |
| `--cmp-above` | `#c5610f` | `#b16512` | Time above the band |
| `--c-day` | `#b87a00` | `#c98500` | Day |
| `--c-night` | `#4a5aa8` | `#738aed` | Night |
| `--cause-vpd` | `#c2410c` | `#d9772f` | Water run because the air was dry |
| `--cause-schedule` | `#8a5a00` | `#c98500` | Water run by a schedule |
| `--cause-prep` | `#65731f` | `#81880e` | Water run to prepare a line |

`--c-outdoor` is a deliberate neutral: it fails the validator's chroma floor because it is context, not a
subject, so it is never the only cue; an outdoor line is dashed and named in the legend. Threshold lines on a
chart use `--warn` and `--critical` and carry a text label. A law request lane uses `--accent`; a refused or
waiting span uses a hatch of `--warn`; an unknown span uses a hatch of `--text-3`.

To re-check a set after changing it, run the palette validator on the ordered list, once per theme, for
example `validate_palette.js "#c97400,#b61f02,#12947f,#4b55b5,#7f8f16,#1695c4,#a3279e" --mode light --surface "#ffffff"`.

### 2.4 Contrast pairs the test computes

In both themes: `--text`, `--text-2` and `--text-3` on `--bg`, `--surface` and `--surface-2` (4.5:1).
`--text-3` is for those three only, never on `--surface-3` (4.45:1 in the light theme): text on the segmented
control's track (a segment's count) is `--text-2`, and the current segment's count takes the segment's own colour.
`--accent` on `--bg`, `--surface` and `--surface-2` (4.5:1); `--on-accent` on `--accent`, `--accent-hover` and
`--critical` (4.5:1); `--accent-text` on `--accent-soft`; each status text on its soft background (4.5:1); each status solid on
`--surface` (3:1); `--control-border` on `--surface` and `--bg` (3:1); `--rail-text` and `--rail-muted` on
`--rail`, `--rail-active-text` on `--rail-active` (4.5:1); `--hero-text`, `--hero-text-2`, `--hero-accent` and
`--hero-warn` on `--hero` (4.5:1); every chart colour of 2.3 except the wash and the grid on `--surface` and `--bg` (3:1).

### 2.5 Type, space, shape

| Token | Value |
|---|---|
| `--font` | `"IBM Plex Sans", system-ui, sans-serif` |
| `--mono` | `"IBM Plex Mono", ui-monospace, monospace` |
| `--fs-xs` / `--fs-sm` / `--fs-md` / `--fs-lg` / `--fs-xl` / `--fs-2xl` / `--fs-3xl` | `.75rem` / `.8125rem` / `.9375rem` / `1.125rem` / `1.5rem` / `2rem` / `2.75rem` |
| `--space-1` to `--space-8` | `.25`, `.5`, `.75`, `1`, `1.5`, `2`, `3`, `4` rem |
| `--radius-sm` / `--radius` / `--radius-lg` / `--radius-pill` | `6px` / `10px` / `14px` / `999px` |
| `--shadow-1` / `--shadow-2` / `--shadow-3` | light: `0 1px 2px rgb(15 31 43 / 6%)`, `0 4px 16px rgb(15 31 43 / 10%)`, `0 16px 48px rgb(15 31 43 / 20%)`; dark: `none`, `0 4px 16px rgb(0 0 0 / 35%)`, `0 16px 48px rgb(0 0 0 / 55%)` |
| `--rail-w` / `--content` / `--gutter` | `15rem` / `88rem` / `clamp(1rem, 3vw, 2rem)` |
| `--tap` / `--bar-h` / `--topbar-h` | `2.75rem` / `3.5rem` / `3.5rem` |
| `--z-raised` / `--z-sticky` / `--z-nav` / `--z-popover` / `--z-dialog` / `--z-toast` | 3 / 10 / 20 / 30 / 40 / 50 |

Text: body `--fs-md` at 1.5; tables and captions `--fs-sm`; page title `--fs-xl` at weight 600 (`--fs-2xl` above
860 px); card title `--fs-lg` at 600; a stat value `--fs-xl` at 600 and the hero value `--fs-3xl`; eyebrows and
table heads `--mono` at `--fs-xs`, uppercase, `.06em` tracking, `--text-3`. Every number uses tabular figures.
Line length for prose is at most 70 characters.

## 3. Layout

- **Frame.** Above 860 px: the rail (`--rail-w`, fixed, scrolls on its own) and a content column with a sticky top
  bar (`--topbar-h`) and the page inside `--content`. At 860 px and below: a top bar, the page, and the bottom
  bar (`--bar-h`, with the safe-area inset). 860 px is the one breakpoint of the frame (`lib/narrow.ts`).
- **Page.** A page header (breadcrumb of group and section, the title, one line that says what the page is for,
  a status line, at most two actions), then tabs when the section has more than one view (underlined tabs that
  scroll sideways rather than wrap), then a 12-column grid with a `--space-4` gap (`--space-5` above 860 px).
- **Card.** `--surface`, a 1 px `--border`, `--radius-lg`, `--shadow-1`, `--space-4` padding (`--space-5` above
  860 px). A card has a title row (the title, an optional as-of time, an optional link to more), a body and an
  optional foot. Cards never nest; a group inside a card is a section with a `--border` rule above it.
- **Order.** The answer, then the evidence, then the controls, then the explanation (collapsed).
- **Empty, loading, stale, failed.** Every card has all four: a skeleton of its final height while it loads, a
  plain sentence when there is nothing to show, its last values muted with the word STALE and the time when the
  data is old, and a sentence with Retry when its read failed. A failed card never takes the page down.
- **One observation time a page.** The page header's status line says how fresh the page is. A fresh panel shows
  no "Updated" line (`Panel` `age="auto"`, the default); it shows its own age only when its live read (a relay, a
  probe, the controller) is not the header's (`age="always"`). Panels of daily or historical data never do. A stale,
  not reporting or failed panel says so in its own state line either way.
- **Card head.** The title, then at most one pill; the head's end (an as-of time, actions, the "X ›" link, the ⋯
  menu) stays on the title's line at the right. A pill that does not fit beside the title wraps under it; it never
  pushes the link to a line of its own. On a phone a head's own controls (a range switch) take the line under the
  title.
- **Links.** Every "X ›" link ends in a thin space and the chevron, from one component (`layout/chevron.tsx`
  `Chevron`), in a panel head, a section head and inline alike.
- **Words standing alone.** The words families are lower-case fragments for the middle of a sentence; in a cell, a
  tile, a pill or a key-value value they start with a capital through `sentenceStart()` (`lib/format.ts`). A code
  with no words reads "Unknown (<code>)" in `--text-3` (`unknownWords`, `.word-unknown`); a setting is named by its
  catalog label, or "Retired setting" with its key under it in small mono (`settingName`, `.key-mono`). No raw key
  or code is ever the name of a thing.

## 4. Components

Existing components are restyled in place; their names and props stay unless a row says otherwise.

| Component | File | v2 |
|---|---|---|
| Rail, top bar, bottom bar, More sheet | `components/site-header.tsx`, new `components/shell/*` | README section 3.2 |
| Theme switch | new `components/shell/theme-switch.tsx` | System, Light, Dark; a `theme` cookie the server reads, so the first paint has the right theme |
| Search | new `components/shell/search.tsx` (takes over `control/find-setting.tsx`) | One dialog: pages, settings, relays, water lines, glossary terms |
| Page header, tabs | `components/layout/page-header.tsx` | Breadcrumb, title, purpose, status, actions, underlined tabs |
| Card, panel, section header | `components/card.tsx`, `panel.tsx`, `layout/section-header.tsx` | One look (section 3) |
| Stat | `components/data/metric-tile.tsx` | Label, value with unit, the change against a mean (`data/delta.tsx`), an optional sparkline, an as-of or a footnote |
| Band gauge | `components/data/band-bar.tsx` | A track with the band as a zone, the reading as a marker, the two edges labelled; optional threshold ticks with labels; the reading's relation in words ("in band", "0.4 °F below") |
| Checklist | new `components/data/checklist.tsx` | Rows of a met, unmet or unknown mark, a statement and a detail; used for the drying decision and for running alone |
| Badge, chips | `components/badge.tsx`, `chips.tsx` | The six statuses of 2.2, each with an icon or a dot; sizes md and sm |
| Button | `components/button.tsx` | Primary (accent fill), secondary (outline), quiet (text), danger (critical fill); md is 44 px, sm is 36 px inside a 44 px target |
| Segmented control | `charts/range-chips.tsx` and new `components/segmented.tsx` | One selected segment on `--surface` over a `--surface-3` track; a segment's `count` sits a gap after its words ("All 135"), never glued to them |
| Table | `components/table.tsx` | Sticky head, numbers right-aligned, row hover; on a phone a table either scrolls inside its card with its first column fixed or becomes a list, by a prop. The table rules below |
| Banner | `components/banner.tsx` | Status soft background, status icon, one sentence, one action |
| Dialog, drawer, sheet | `run-dialog.tsx`, `control/setting-drawer.tsx`, `check-sheet.tsx` | A drawer from the right above 860 px and a sheet from the bottom below; `--shadow-3`, `--scrim` |
| Empty state, skeleton | new `components/empty-state.tsx`, `components/skeleton.tsx` | Section 3 |
| Info tip, term, popover, menu, toast | existing | Restyled |

### 4.1 Tables

- Cells keep their words whole: a wide table scrolls inside its region rather than crushing a column; a number never
  wraps; a cell of free text opts in to wrapping with `cell-text` and is kept to two lines.
- Units live in the header, after a comma ("Electricity, kWh"); a cell is a bare number in tabular figures. A header
  is short: at most two words a line.
- A header's words are the uppercase micro-label; its unit keeps its case in a `.unit` span
  (`.unit{text-transform:none;letter-spacing:0}` in primitives.css), so "kWh" never reads "KWH". `Table` and the
  charts' data tables wrap a string header's unit for you (`headWithUnit`: after its last comma, or in brackets); a
  header built as JSX wraps its own.
- A row is one line high at 1440 px. A table whose rows are not has too many or too wide columns: shorten, merge, or
  move the detail to the row's drawer or disclosure.
- Related columns share a group header (`headerGroup` on each column): consecutive columns with the same group get
  one cell in a first header row; a column without a group spans both rows. The phone list ignores groups.
- A long table shows its first rows and a "Show all N <noun>" button under it (`maxRows`, `rowNoun`); a table of days
  shows 14, newest first. The button reveals the rest in place; a text filter always searches every row.
- On a phone a table of more than five columns scrolls with its first column fixed; one of five or fewer may be a
  list (`phone="list"`). In the list the row header is the card's title, with no label, and a column marked
  `titleAside` (a state pill) sits on the title's line at the right.

## 5. Charts

- uPlot draws time series and lanes, through `charts/uplot-chart.tsx` only. Small marks (gauges, meters,
  sparklines, the rule ladder) are SVG or HTML with CSS custom properties.
- A chart reads its colours from the tokens when it is built and again when the theme changes.
- One y axis per chart. Two measures with different units are two charts on a shared time axis.
- A line is 2 px; an outdoor line is 1.5 px dashed; the band is a wash with 1 px edges; the present moment is a
  1 px `--text` rule labelled Now. Bars have a 4 px radius at the data end and a 2 px gap; stacked segments are
  separated by 2 px of the surface.
- A chart with two or more series has a legend; a chart with one names it in its title. Text is never drawn in a
  series colour. The legend (and the key of marks that are not series) is one line above the plot.
- Every chart has a pointer and keyboard readout (a crosshair with a tooltip on a line, a tooltip per mark on
  bars and lanes), a table of the same data behind a disclosure, and a CSV of that table.
- Under the plot, one quiet line (`charts/data-table.tsx` `ChartFoot`): the "Data table · N rows" disclosure at the
  left, the chart's tools (Reset zoom) and "CSV" at the right, in muted link style with no outline box and a 44 px
  target through padding. An opened table unfolds under the line.
- Small multiples share one legend: a `ChartGroup` (`charts/legend.tsx`) draws the charts' keys once, one line above
  its first row, and each chart inside keeps only its title, its plot and its quiet line. A chart outside a group
  drops its own legend with `legend={false}`.
- A chart reserves its height before its data arrives.
- A daily chart draws today, a day still in progress, lighter and labels it "so far"; a day with no record is a
  gap, never a zero. A mean line covers complete days only.
- Daily light integral is not charted: the house has no light sensor that can support it.

New kinds for v2, each a pure `build…` model, an options function and the shared tooltip, table and CSV:

| Kind | For |
|---|---|
| Daily bars | One measure per day with its 7-day mean line and its 30-day mean as a reference line; optional threshold |
| Daily stack | Parts of a day: time in band, below and above; water by use; drying refused by reason |
| State lanes | Rows of on, off and unknown spans from intervals: law requests, relays, the drying decision, the outdoor source |
| Threshold series | A measured line with labelled warning and critical lines: the controller's hardware budget |
| Cost against limit | The drying price with the limit as a stepped line and the refused spans shaded |
| Rule ladder (SVG) | One axis per signal: the band as a zone, each rule's on and off values as ticks, the reading as a marker |

## 6. Tests that state these rules

The tests that pinned the first design system are rewritten to state v2's rules.

| Test | States |
|---|---|
| `app/styles.test.ts` | Tokens exist once; light and both dark blocks define the same colour tokens; the two dark blocks are equal; the load order of the stylesheets |
| `app/styles/sections.test.ts` | The list and order of the section stylesheets; no colour literal outside `tokens.css`; a reduced-motion rule exists |
| `app/styles/contrast.test.ts` (replaces `components/badge-contrast.test.ts`) | The pairs of 2.4 meet their ratios in both themes, computed from `tokens.css`; no component holds a colour literal or a `style` attribute |
| `app/charts/chunks.test.ts` | uPlot only through `uplot-chart.tsx`; every chart route exports `chartLinks()`; no daily light integral in chart code |
| `e2e/layout.spec.ts` | No horizontal scroll at 360, 390, 820 and 1440 px; the bottom bar has five items and More lists every section; the rail lists every section in order; reduced motion |
| `e2e/a11y.spec.ts` | axe WCAG 2.2 AA on every route at 320, 768 and 1440 px, in light and in dark |
| `e2e/00-experience-visual.spec.ts` | Screenshots of every v2 screen at 1440 and 390 px in both themes and at 820 px in light |
