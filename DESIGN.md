---
name: "This or that — Things Folio"
description: "Selected live tournament chrome, with faithful Folio light and slate dark appearances."
colors:
  canvas: "#edf0f2"
  paper: "#fcfdfd"
  bar: "#f6f8f9"
  field: "#f8fafb"
  ink: "#263039"
  muted: "#59656e"
  line: "#dce2e6"
  control-line: "#aab5bd"
  blue: "#365e7d"
  blue-wash: "#edf3f8"
  clay: "#805b49"
  clay-wash: "#f6efea"
  hover: "#e7edf1"
  selection: "#d5e4f0"
  scroll-thumb: "#8b99a3"
  error: "#a1373e"
  error-wash: "#faeeee"
  on-accent: "#fcfdfd"
  preview-paper: "#fcfdfd"
  dark-canvas: "#1c242b"
  dark-paper: "#283139"
  dark-bar: "#232c33"
  dark-field: "#202930"
  dark-ink: "#edeae4"
  dark-muted: "#b5bdc1"
  dark-line: "#414d56"
  dark-control-line: "#73818b"
  dark-blue: "#abcce5"
  dark-blue-wash: "#303f4b"
  dark-clay: "#dfb9a4"
  dark-clay-wash: "#443930"
  dark-hover: "#35414b"
  dark-selection: "#455f72"
  dark-scroll-thumb: "#778791"
  dark-error: "#f0b1b3"
  dark-error-wash: "#482f35"
  dark-on-accent: "#202930"
typography:
  title:
    fontFamily: "Atkinson Hyperlegible Next, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-.025em"
  body:
    fontFamily: "Atkinson Hyperlegible Next, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  annotation:
    fontFamily: "Atkinson Hyperlegible Next, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  annotation-label:
    fontFamily: "Atkinson Hyperlegible Next, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontFamily: "Lato, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: "Lato, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.5
  metadata:
    fontFamily: "Lato, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  manifest:
    fontFamily: "ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  check: "3px"
  control: "5px"
  window: "12px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
  space-8: "32px"
  space-9: "36px"
  space-10: "40px"
  space-11: "44px"
  space-12: "48px"
  space-16: "64px"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "4px 12px"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-active:
    backgroundColor: "{colors.blue-wash}"
  button-disabled:
    backgroundColor: "{colors.bar}"
    textColor: "{colors.muted}"
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "4px 12px"
  button-primary-hover:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.blue}"
  button-choice-left:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.blue}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-choice-right:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.clay}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  annotation-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.annotation}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "{spacing.space-16}"
  annotation-field-focus:
    backgroundColor: "{colors.paper}"
  top-navigation:
    backgroundColor: "{colors.bar}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "8px 16px"
  rehearsal-badge:
    backgroundColor: "{colors.clay-wash}"
    textColor: "{colors.clay}"
    typography: "{typography.metadata}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  folio-document:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.window}"
  folio-candidate:
    backgroundColor: "{colors.paper}"
    padding: "{spacing.space-4}"
  folio-candidate-left-interaction:
    backgroundColor: "{colors.blue-wash}"
  folio-candidate-right-interaction:
    backgroundColor: "{colors.clay-wash}"
  folio-marker-left:
    textColor: "{colors.blue}"
    rounded: "{rounded.control}"
    width: "{spacing.space-6}"
    height: "{spacing.space-6}"
  folio-marker-right:
    textColor: "{colors.clay}"
    rounded: "{rounded.control}"
    width: "{spacing.space-6}"
    height: "{spacing.space-6}"
---

# Design System: This or that — Things Folio

## Overview

**Creative North Star: "Things Folio — two paper-like reading paths"**

The user explicitly selected Things Folio from the catalog. It is now the live tournament identity: cool paper, Atkinson reading type, Lato controls and two facing candidate pages, each carrying its own preview, annotation and choice. This record describes that implemented chrome, not a new exploration.

The frontmatter is normative for the live app only. Its light palette preserves the original Folio; dark mode uses slate surfaces with the same blue/clay roles. `/mockups` remains eighteen independent previews inside its fixed dark reviewer wrapper. `tournament/chrome-designs/things-folio.html` remains the historical light-only mockup. Original candidate documents keep their own styling and behavior; neither the live theme nor this record rethemes them.

**Key Characteristics:**
- A heading-level choice, tall preview and annotation kept together on each folio page.
- Real tournament navigation, save/recovery feedback and a native appearance selector.
- One live visual system across comparison, sessions, gallery and rankings.

Source of truth: [style.css](tournament/style.css), [index.html](tournament/index.html), [app.js](tournament/app.js), [appearance.js](tournament/appearance.js) and the normative [.impeccable/design.json](.impeccable/design.json) sidecar. Historical Folio review recorded a live smoke and nine passing browser tests, including real-iframe hover, exclusive focus, light/dark, reduced-motion and touch behavior without draft, iframe or ranking loss. Review captures and measurements remain private local artifacts, not repository downloads. These historical observations make no exhaustive state/accessibility claim; current commands and coverage are documented in [the README](README.md#checks-and-test-scope).

## Colors

Light uses the original cool canvas, near-white paper and blue/clay accents. Dark changes the shell to slate with warm light ink, pale blue and pale clay; it is not a filter or an inverted candidate preview. Unprefixed frontmatter colors match `:root`; `dark-*` records the corresponding overrides under `html[data-theme="dark"]`. Components describe light values; the runtime rebinds the same CSS variables for dark mode.

- **Blue:** left-page marker/choice, links, focus and primary actions; `blue-wash` supports interaction and the winner summary.
- **Clay:** right-page marker/choice and the rehearsal badge; `clay-wash` supplies their soft backing. These are side identities, not a selected/unselected state.
- **Neutrals:** `canvas` surrounds the `paper` document; `bar` supports navigation/feedback, `field` annotations, `line` rules and `control-line` control edges. `ink`/`muted` separate reading from metadata.
- **States:** `error`/`error-wash` distinguish recovery failures; `selection` and `scroll-thumb` are native-browser treatments. `on-accent` is primary-button text. `preview-paper` stays unchanged in dark mode; iframe documents retain their own color schemes.

## Typography

[fonts.css](tournament/chrome-designs/fonts.css) serves local WOFF2 files with `font-display: swap`: Atkinson Hyperlegible Next variable 100–900 and Lato 400/700. Preserve bundled font licenses and provenance; no runtime font CDN is required.

Atkinson carries the 16px/1.5 reading body, 24px/650 candidate and page headings, and 14px annotations. Lato carries 14px controls and 13px metadata/status/keycaps. The compact topbar title is Lato 14px/700, not a second display heading. Gallery subheadings use 16px/650; manifest JSON alone uses the system monospace stack at 13px. Keep sentence case and tabular ranking/position numerals.

## Layout

The paper document has no width cap: 12px desktop canvas gutters and 16px candidate padding keep the scenes almost full width with modest breathing room. A 64px-minimum topbar holds identity, progress, status, Appearance and a native **More** disclosure for secondary navigation, with 16px desktop gaps/insets. Beneath it, two `minmax(0, 1fr)` folio pages share a 1px central rule. Each page keeps **heading + Choose → tall preview → annotation** together; choice stays beside the title, not below the scene. Heading/marker spacing is 12px; metadata has 8px above and 12px below. Preview height remains `max(640px, calc(100dvh - 176px))`. Shared Skip/Like both/Hate both, Save notes, Undo response and pair feedback follow the previews and notes rather than taking space above them.

At **1100px and below**, the gallery becomes two columns, the winner summary stacks and header gaps tighten. At **760px and below**, canvas gutters become 8px, the header uses a compact two-column grid and candidate pages stack with a horizontal divider. Each mobile preview is `max(560px, 76dvh)` tall; candidate padding remains 16px. Buttons, inputs, selects and navigation items receive a 44px minimum height. Response tools and pair feedback wrap below the scenes; the gallery becomes one column. Rankings scroll inside their table wrapper. Sessions retain a 1056px maximum container and explanatory copy a 72ch measure.

Historical final-smoke geometry: at 1512×980 the iframes were 710/709px wide × 804px tall, starting at y=177; at 1920×1080, 914/913px × 904px. At 390×844, stacked previews were 340px × approximately 641px, with a 213px rehearsal header after wrapping. Keep this generous preview space rather than restoring the earlier capped document or short frames.

## Elevation & Depth

Only the outer document and controls receive shadows: `--shadow` gives the paper a shallow lift; `--control-shadow` separates buttons and the More toggle from it. Their exact light/dark values are in the sidecar. Candidate pages remain flat, separated by rules rather than nested floating cards; interaction adds only a side-accent wash, thin preview edge and accented metadata. The More menu uses paper, a control border and navigation layer 20, not a new shadow. Controls, candidate backgrounds and preview borders transition over 160ms with `--ease-out`; reduced-motion removes these transitions and uses automatic scrolling.

## Shapes

Use 12px `window` corners for the document, gallery cards and winner/no-winner summaries; 5px `control` corners for buttons, fields, page markers and errors; 3px `check` corners for check marks/keycaps. Preview borders are square, 1px rules. Focus is a 2px blue outline with a 4px offset, not an extra shadow. No pill-shaped replacement for the small rectangular rehearsal badge.

## Components

- **Buttons:** paper/ink defaults use a control border and shadow, with 36px desktop minimum height for buttons, selects and More; hover uses `hover`, active uses the local accent wash. Primary “New comparison” is blue/on-accent and becomes blue text on blue-wash at hover. The heading-level “Choose” button is at least 40px tall, with 8px × 12px padding, side accent, check mark and arrow keycap; the accessible label retains the full candidate name. Hover uses that side’s wash. Disabled controls use muted/bar/line with no shadow and a not-allowed cursor.
- **Annotations:** the candidate name stays in the label, with “Optional” beside it. The 64px textarea uses field/ink, a control border, local-accent caret/hover border, paper on focus and the blue focus outline. Textareas resize vertically; saving makes notes read-only rather than removing them. Pair feedback remains a separately labeled field.
- **Navigation and appearance:** a native details/summary **More** disclosure, with explicit button role and synchronized `aria-expanded`, contains Chrome mockups, All candidates and session-dependent Rankings, Export JSON and Sessions controls. It opens a bounded, scrollable 256px menu; Appearance remains visible outside it. Appearance is a labeled native select with `system` (default), `light` and `dark`. [appearance.js](tournament/appearance.js) sets the root theme before styles load, follows system changes only in System mode, and stores a plain mode string at localStorage key `tot-appearance`, synchronized across tabs. Browser-only `window.tournament.appearance` exposes the same control contract; it does not alter tournament data. Storage/invalid-preference feedback appears beside the select without blocking the current appearance.
- **Folio and states:** L/R markers, candidate labels and Open larger precede each preview. “Opening candidate…” occupies the frame while loading. Choice/feedback controls wait for both previews and are unavailable during pending recovery; the shell keeps save/recovery status and retry/inspect actions visible. The rehearsal badge says “Rehearsal · not human evidence”; it is informational, not a chip to toggle.
- **Side interaction:** `--candidate-surface`, `--candidate-edge` and `--candidate-muted` resolve to paper/line/muted at rest and the page’s accent-wash/accent/accent while engaged. On hover-capable pointers, the hovered page wins over stale focus in the other page; only with neither page hovered does focus-within select a page. Touch/non-hover devices use focus-within only. This tints surrounding chrome, never iframe content, and does not vote or change drafts/rankings. `tournament.inspect().comparisonInteraction` exposes the interaction state without introducing a new action.
- **Related screens:** sessions reuse real buttons and muted metadata; gallery cards preserve candidate previews and use the same paper/line/type roles; rankings reuse annotation fields and table rules. The winner panel uses blue-wash, while “No unique winner yet” stays neutral. Selection of Folio never fabricates a candidate winner.

The sidecar contains scoped, token-bound visual specimens extracted from these controls (including their relevant hover/focus/active/disabled styles). Specimens are not wired to live persistence or tournament actions; production behavior remains in the source modules.

## Do's and Don'ts

- Do preserve Folio’s paper layout, Atkinson/Lato pairing and blue-left/clay-right accents in both appearances.
- Do keep each candidate’s annotation and decision with its preview when the pages stack.
- Do reuse the live tokens for status, errors, sessions, gallery and rankings; keep visible labels and focus states.
- Don’t theme candidate documents or the eighteen independent mockups with live-app tokens.
- Don’t replace the native appearance select with decorative or nonfunctional navigation.
- Don’t confuse the selected chrome identity with a tournament winner, or rehearsal activity with human evidence.
