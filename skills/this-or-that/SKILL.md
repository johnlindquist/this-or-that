---
name: this-or-that
description: Generate many concrete variations, rank them with rapid left/right pairwise choices, and export the winner plus all rankings and notes for agent-driven refinement.
---
# This or that

This means a many-candidate preference tournament, NOT a fixed two-prototype usability exercise.

1. Freeze the subject and one comparison axis. Reuse actual supplied content.
2. Generate many structurally distinct candidates (often 10–20 or more). In exploration, good enough to rank is the standard; skip polish and broad testing when requested. Delegate one candidate per agent when authorized, with separate files and a shared interaction contract.
3. Include incumbents. Open directly into two equally presented candidates, with Left/Right selection and immediate advancement—no start gate. Embedded candidates and gallery previews must be immediately interactive without an Explore switch or larger window; Escape returns focus to parent controls. Also support S for Skip (score-neutral), L for Like both (+16 each), and H for Hate both (−16 each). Pause scoring shortcuts inside text fields and focused iframes; Tab focuses/leaves comparison feedback and Shift+Tab preserves normal navigation. Allow candidate/comparison notes. Keep saved sessions and new comparisons accessible through Sessions.
4. Keep comparing to finish a ranking pass. This kit ranks by Elo plus 16 × (likes − hates); the merge-style schedule only organizes matchups. Equal scores share ranks; skipped-only candidates remain unassessed and cannot win. Do not invent a winner for a tie.
5. Export winner source, all ranks, scores, actual choices, notes and provenance. Bring the package back to the agent to refine the chosen direction. Never invent votes, reasons or taste rules.

The runnable app is separate from this instruction pack. Read [references/sprint-demo.md](references/sprint-demo.md) for the current example, [references/interactive-contract.md](references/interactive-contract.md) for all supported HTTP/CLI and browser operations, [references/evidence-and-selection.md](references/evidence-and-selection.md) for interpretation, and [references/reconstruction-prompts.md](references/reconstruction-prompts.md) for useful prompts. Load `/api/v2/discover` before operating the live app; its tournament payload protocol remains `this-or-that/tournament/v1`. Agents may inspect/export human sessions but must create or mutate only rehearsal sessions.

The selected app uses Things Folio with light/dark/system appearance, large previews, friendly spacing and passive side emphasis. Preserve that approved chrome and the candidate designs when maintaining this checkout; the eighteen chrome studies remain previews, not a reason to reopen selection. The current Folio/reviewer browser suite is separate from historical fixed-A/B coverage. Follow the user's requested verification scope rather than treating the original exploration's limited smoke as a permanent no-tests policy.
