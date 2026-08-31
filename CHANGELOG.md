# Changelog

## 2026-08-31 — Standalone publication hygiene

- Aligned private repository metadata and Bun requirements with the standalone tournament app; preserved Folio, all candidate designs and required incumbent assets.
- Included tournament TypeScript in `check`; scoped default e2e runs to the nine current Folio/reviewer tests with an isolated automatic server, while retaining historical fixed-A/B source and test coverage separately.
- Updated installation, agent and skill guidance; separated private records, research/review artifacts and historical downloads from published source. This entry does not claim a push or a new validation run.

Earlier verification entries below describe their historical revisions, not results from this publication cleanup. Lesson/recording materials and review captures remain local and are not repository prerequisites or downloads.

## 2026-08-31 — Eighteen independent designs and keyboard review

- Replaced the nine palette studies with eighteen independently authored HTML designs: three each inspired by Capture One, Figma, Linear, Things, Raycast and iA Writer. Local licensed typefaces, distinct layout structures and component styles; embedded candidate sources stay unchanged.
- `/mockups` now shows one full-size design beneath compact previous/next navigation and a grouped selector. Left/Right wrap through the collection, including focused non-editable preview/candidate controls; typing and select arrows stay local. Escape returns to reviewer navigation. No keyboard action records a preference.
- Cut over discovery to `this-or-that/chrome-mockups/v2`, with revision-guarded select/next/previous/focus operations and honest preview readiness. Each design exposes `this-or-that/chrome-design/v1` for local sample interactions. Switching designs resets preview-local notes and scratch state, never saved tournament data.
- Historical review: all eighteen desktop/mobile captures loaded real candidates and local fonts without page overflow or sampled text-contrast failures. Three focused Playwright regressions passed, as did type checking. The available independent reviewer substituted for the unavailable skill-specific reviewer and returned SHIP; its mobile copy-button naming issue was fixed and confirmed. Review evidence remains private local history.

## 2026-08-31 — Professional comparison themes

- Refined the nine chrome previews into five dark and four light themes sharing one layout, typography, spacing, and control system. Removed layout gimmicks and recommendation badges; kept existing selection IDs and API behavior.
- Quieted notes and general chrome while preserving distinct side accents and filled choice controls. Added consistent hover, focus, disabled, caret, selection, and scrollbar styling without touching embedded candidates.
- One batched browser pass checked all nine at 1512, 1024, and 390 pixels, preserved iframe documents and notes, exercised keyboard selection and stale-revision rejection, and measured sampled text/placeholder contrast at 4.5:1 or better. No page overflow or browser errors observed. The mechanical detector reported no findings in its degraded regex fallback; computed browser checks supplied the contrast evidence.

## 2026-08-31 — Nine comparison-chrome mockups

- Added `/mockups`: nine numbered, selectable chrome directions with distinct left/right colors, stroke icons, and unchanged interactive candidate designs. No theme is applied to the live tournament.
- Added gallery links, a discoverable JSON catalog, and revision-guarded browser selection API. Preview notes and responses stay in page memory and never affect rankings.
- Isolated browser smoke exercised all nine desktop/mobile selections, direct links, keyboard selection, iframe scratch-state preservation, invalid/stale actions, and wait behavior. Reviewed overview and desktop/mobile captures; `bun run check` passed. Existing user server and saved preferences were left untouched.

## 2026-08-28 — Interactive inline candidates

- Removed the Explore gate and pointer suppression: comparison demos and gallery previews accept input immediately. Open larger remains optional.
- Kept comparison feedback available while trying demos. Iframe keyboard input stays local; Escape returns focus to parent controls without disabling the iframe.
- Added browser-agent focus return and focused-frame inspection; retained separate scratch demo state and preference records.
- Focused browser smoke used real pointer clicks to move a ticket to backlog, undo it, and interact again after Escape. Gallery move/reset and Escape also worked; demo actions left rankings unchanged, while a parent S key recorded the sole rehearsal skip. Inspected the inline capture; no broad suite run.

## 2026-08-28 — Direct comparison and keyboard feedback

- Removed the initial start screen; opening the app creates a comparison directly, while session URLs resume existing work. Sessions remains available without clearing current drafts.
- Replaced the main shell's forest-green palette with neutral grays, charcoal and restrained blue accents. Candidate designs remain unchanged.
- Added S/H/L feedback shortcuts and visible key badges. Text fields suppress scoring shortcuts, Tab toggles comparison feedback focus, and Shift+Tab retains normal navigation. Held keys cannot submit repeated responses.
- Extended agent discovery and browser inspection with shortcut/focus capabilities. Brief isolated browser smoke verified direct entry, exact outcomes, typing guards, Tab, repeat protection, session return, reload and the browser interface; desktop and narrow captures inspected.

## 2026-08-28 — Shared comparison feedback

- Added Skip, Like both, and Hate both controls and agent commands. Skip leaves scores unchanged; like/hate adjust both candidates by +16/−16 without fabricating a winner or relative Elo draw.
- Rank by Elo plus shared-feedback adjustments, with shared ranks for ties, unassessed candidates last, and winner export only for a unique assessed leader. Merge order now schedules comparisons rather than deciding standings.
- Preserve response/candidate notes, undo, exports, and saved legacy choices across the change.
- Focused rehearsal smoke: all three real browser buttons, notes, undo, reload, keyboard voting, exact scores, tied ranks, and unavailable tied-winner export. A 70-choice legacy rehearsal retained its evidence. No broad test suite or human-preference claim.

## 2026-08-28 — Many-candidate exploration

- Corrected the premise: a reusable many-candidate ranking tournament, not a fixed A/B usability exercise.
- Added 20 structurally different runnable UI drafts from 20 independent agents, retaining the two incumbent widgets. Agents skipped tests, builds and polish reviews.
- Made left/right choices advance immediately, with optional candidate and matchup notes, explicit demo interaction, undo, complete merge-tournament ordering and supporting Elo match ratings.
- Added persistent ranking sessions and JSON/Markdown evidence export plus a standalone winning HTML demo. Migrated the supported CLI and skill instructions to the new protocol.
- Brief integration smoke only: 22 candidate file routes available, keyboard choices/notes/reload observed, one 70-choice rehearsal ranked all 22, and exported winner HTML loaded offline. No production-readiness or new human-preference claim.
- Main start now runs `tournament/server.ts`; prior records and fixed-A/B artifacts remain preserved separately.

## 2026-08-28 — Recording-readiness review fixes (historical fixed-A/B app)

- Kept normal in-flight writes in Saving feedback instead of error recovery, and cleared obsolete announcements/board scroll on fresh sessions and prepared task loads without erasing the other pane's independent confirmation.
- Deferred note autosave during pointer interaction while retaining local recovery immediately. Guarded task/finish/navigation transitions, retained full unsaved-note recovery, and recovered session-local selection reasons without committing a choice. Note/reason limits count Unicode code points and retain overlong drafts for correction.
- Added explicit Refresh saved state for external rehearsal changes without replaying uncertain requests. Restored focus to new task/result headings and scrolled moved-ticket focus within its board.
- Corrected horizontal backlog hit testing for unequal-height rows, kept insertion feedback within the visible board, and removed stale insertion cues when a hover-expanded header is not a valid drop. Precise placement requires moving into the expanded list; natural edge scrolling remains available.
- Replaced the opening with an actual A drag within ten seconds and B interaction within the first minute; supplied a complete approximately nine-minute spoken script, compact cue sheet, and YouTube title/description/chapter copy. Timecodes are pacing targets, not measured footage.
- Moved setup off camera and kept the raw API walkthrough in written follow-up. Added clear prepared-kit, source-and-skill reconstruction, practice, and actual-recording analysis routes; distinguished instructions from runtime and provided prompts from verified generation history.
- Matched the guide to note-before-choice, Saved → Next task, Finish without selection, explicit selection auto-navigation, View sealed comparison, and export-after-selection behavior. Kept every human choice/reason and all outcome-dependent endings unscripted.
- Corrected priority explanations to #1 highest, including A's left-to-right desktop Unassigned grid and vertically stacked narrow layout, without changing the fixture. Synchronized the full script, prompts, helper contract, and evidence boundaries in the self-contained skill.
- Hardened installer partial-write cleanup by tracking exclusively created files before writing and syncing them; occupied destinations remain preserved and the error directs callers to a nonexistent directory.
- Ordered graceful server shutdown to drain repository work and lock cleanup before stopping the listener. Explicit SIGTERM/wait/start remains the documented supervision path; forced termination may still require PID-verified stale-lock recovery.

Historical fixed-A/B integration passed TypeScript, 22 unit/API/installer tests (370 assertions), and all 20 browser tests. Real CLI refresh, Bun transport limits, occupied-port cleanup, and exact state recovery after SIGTERM/restart were also exercised. Six captures were refreshed and visually inspected. The verification record remains in the local lesson archive; these results do not certify the current tournament app. No human winner, empty-project reconstruction, or published companion download is claimed.

## 2026-08-28 — Prepared sprint comparison lesson (historical fixed-A/B app)

- Documented the fixed `sprint-demo-v1` subject: eight synthetic tickets, three developers, Unassigned, and exact S0–S3 checkpoints for assignment, priority, and handoff.
- Added a screen-led recording guide with real drag/non-drag demonstrations, separate rehearsal and human-recording segments, optional selection, and honest unselected/rejected/incomplete endings.
- Added setup, session-mode, API/CLI usage, recovery, export, cleanup, provenance, and limitation guidance against the frozen `this-or-that/v1` contract.
- Added six copyable prompts for reconstruction, both candidates, evidence-safe rehearsal, recording analysis, and honoring an explicit human selection.
- Packaged a self-contained `this-or-that` skill with complete contracts, fixture, evidence rules, and prompts. Added a JSON-output installer with an optional destination, identical-install handling, and refusal to overwrite nonidentical destinations.
- Kept the prepared result **unselected**. No human votes, preference report, or winner was supplied.

Verification and captures are recorded by the integration owner from actual execution; this changelog does not assert unrun checks passed or that the optional skill was installed.
