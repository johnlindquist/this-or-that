# Tournament agent interface

Live entrypoint: `bun run start` → `tournament/server.ts`, normally `http://127.0.0.1:8477`. Discovery is `GET /api/v2/discover`. The HTTP route namespace is **v2**; its tournament payload protocol is still **`this-or-that/tournament/v1`**. Do not substitute the historical fixed-A/B `/api/v1` interface. Source candidates remain trusted local HTML files, and actor labels are not authentication.

## Operations

| Operation | HTTP |
|---|---|
| Discover capabilities, schemas, collection, permissions | `GET /api/v2/discover` |
| List sessions | `GET /api/v2/tournaments` |
| Create | `POST /api/v2/tournaments` |
| Inspect saved state, current pair, controls, standings | `GET /api/v2/tournaments/{id}` |
| Act | `POST /api/v2/tournaments/{id}/actions` |
| Wait for a revision | `GET /api/v2/tournaments/{id}/wait?after=N&timeout=3000` |
| Diagnose | `GET /api/v2/tournaments/{id}/diagnose` |
| Export | `GET /api/v2/tournaments/{id}/export?format=json|md|html` |

Mutations require JSON and `x-tot-client: agent|ui`, plus `x-tot-nonce` from current discovery. Agents can create/mutate only `rehearsal` sessions. Human sessions are read-only to the documented agent client. Neither label authenticates a person; do not expose this server publicly.

Create body: `{requestId: UUID, mode: "rehearsal", title?: string, options?: Candidate[]}`. The UUID is the session ID. Without `options`, the current `tournament/options.json` collection is used. Each candidate requires unique `id`, `name`, and local `/candidates/NAME.html` `src`; `description` is optional. Discovery describes the complete input. Existing records retain candidate metadata/source hashes.

Discovery returns the current `nonce`, catalog, endpoints, schemas, permissions, semantic controls and browser-interface metadata. `list` returns `{ok:true,sessions:[...]}` with ID, title, mode, revision, comparison count, completion, winner ID and creation time. Create, inspect, actions and wait return `{ok:true,state,standings,complete,winner,controls}`; `state` holds the durable revision, current pair, notes and comparison evidence. `diagnose` reports the session ID/revision, mode, candidate/comparison counts, pending pair and storage type; it does not repair data.

Wait accepts `after` (default `-1`) and `timeout` in milliseconds (default `3000`, bounded to `0–10000`). It returns the latest inspection on a newer revision or timeout; compare `state.revision` yourself, because there is no separate `changed` flag. Reaching a timeout does not imply a mutation or authorize a retry.

Action envelope:

```json
{
  "requestId": "a fresh UUID",
  "expectedRevision": 0,
  "action": {
    "type": "vote",
    "pairId": "the inspected current pair UUID",
    "winner": "the inspected left or right candidate ID",
    "note": "optional comparison reason",
    "notes": {"candidate-id": "optional candidate-specific observation"}
  }
}
```

Other actions:

- `{type:"note", candidateId, text}`
- `{type:"undo"}` reverses the most recent comparison response in the current pass, including shared feedback; candidate notes remain.
- `{type:"refine"}` starts another pass only after a complete ranking, preserving candidate notes and prior comparison evidence.

Shared outcomes use `{type:"feedback", pairId, outcome:"skip"|"like-both"|"hate-both", note?, notes?}` inside the same exact-revision envelope. They advance the schedule and preserve candidate/comparison notes. Records have `outcome` and null `winner`/`loser` for feedback; older winner-only records normalize as `outcome:"winner"` without losing evidence. Undo supports every outcome.

Reuse an identical request ID/body only to reconcile that exact uncertain action. A changed payload or stale revision is rejected. Inspect before making another decision; never silently rebase a preference. The UI recovers local drafts and exact pending envelopes separately from server state.

An identical action replay returns the current inspection with `replayed:true`, without recording another response. HTTP failures return `{ok:false,error:{message}}`: malformed actions are rejected, stale revisions or changed request payloads return `409`, missing sessions return `404`, and agent mutations of human sessions return `403`. Rediscover the nonce after a server restart. A stale current pair is also rejected; do not infer a replacement pair or winner.

## Ranking and exports

A merge-style schedule compares current group heads; non-winning feedback consumes both heads as a neutral scheduling batch. That scheduler order is not ranking evidence. **Final score = Elo + 16 × (likes − hates)**. Left/right choices use initial Elo 1000 and K=32. Skip increments skip counts only; Like both adds one like to each, Hate both one hate to each. Ratings expose `elo,wins,losses,likes,hates,skips,score,assessed`; assessment requires a win/loss/like/hate, not a skip. Complete equal scores share competition ranks; unassessed candidates have rank null and cannot win. `state.winnerId` is the unique assessed leader only when complete, otherwise null. Standings remain provisional during a pass. Existing records retain their choices, notes, IDs and receipts while derived standings are recalculated.

JSON export includes winner metadata and self-contained HTML when a unique assessed leader exists, standings, outcome counts, candidate notes, every comparison, source paths/hashes, pass and provenance. Markdown is a concise agent handoff. Standalone winner HTML needs no running server. Incomplete, top-tied or entirely unassessed results have no winner HTML; JSON/Markdown still export the evidence honestly. Never treat rehearsal evidence as human preference.

## CLI

Run `bun run agent -- OPERATION [--flag value ...]` from this checkout. With no operation it defaults to `discover`. Supported operations are `discover`, `list`, `create`, `inspect`, `act`, `wait`, `diagnose` and `export`; there are no CLI appearance, preview-selection or fixed-A/B task commands.

- `--base http://127.0.0.1:8477` changes the loopback origin for any operation.
- `--session UUID` is required for `inspect`, `act`, `wait`, `diagnose` and `export` and targets one exact tournament.
- `create --mode rehearsal --request UUID` creates scratch state. Both flags are optional: mode is always rehearsal and an omitted request ID is generated. Preserve an explicit UUID and identical create payload when reconciling uncertain creation.
- `create --json '{"title":"Scratch comparison"}'` adds optional creation fields. Include an `options` array using the collection schema above to replace the default collection; only existing local candidate HTML sources are accepted. JSON fields merge into the create body (a JSON `requestId` overrides `--request`); mode is forced to rehearsal.
- `act --session UUID --json 'ENVELOPE'` submits the complete action envelope shown above; the CLI does not synthesize revisions, pair IDs or action request IDs.
- `wait --session UUID --after N --timeout 3000` observes the HTTP wait contract above. Omitted `after` defaults to `-1`.
- `export --session UUID --format json|md|html` defaults to JSON evidence. The CLI always prints JSON; Markdown/HTML HTTP bodies are wrapped as `{ok,format,content}` rather than written as files.

The CLI sets `x-tot-client: agent` and fetches the current discovery nonce before POSTs. Handled HTTP/operation errors produce JSON and a nonzero exit status; malformed CLI argument syntax may throw before JSON handling, so always use `--flag value` pairs. Inspect the returned state before the next decision; no command silently rebases a stale action.

## Candidate interactions

Generated demos import `/candidate-kit.js`; the two incumbents use `/incumbent.js`, which wraps the same `createDemo` helper around the retained widgets. Every built-in candidate exposes `window.demo`: `owners`, `tickets`, `queues`, `revision`, `ownerOf(ticketId)`, `list(ownerId)`, `points(ownerId)`, `move(ticketId,ownerId,beforeTicketId=null)`, `shift(ticketId,delta)`, `reset()`, `undo()` and `inspect()`. All use the existing shared movement reducer. These are scratch interactions, not votes.

Supported browser-agent transport: send a same-origin message to the candidate iframe:

```json
{"protocol":"this-or-that/candidate/v1","requestId":"correlation-id","operation":"inspect"}
```

The reply includes `ok`, the same `requestId`, and state with revision, queues, tickets, owners and available actions. Mutations require the inspected `expectedRevision`:

```json
{"protocol":"this-or-that/candidate/v1","requestId":"correlation-id","operation":"move","expectedRevision":0,"ticketId":"SPR-103","ownerId":"leo","beforeTicketId":"SPR-107"}
```

`reset` and `undo` use the same revision envelope. Source checks require the parent window and exact origin. Semantic UI targets include `choose-left`, `choose-right`, `skip`, `like-both`, `hate-both`, `note-{candidateId}`, `pair-note`, `save-notes`, `undo`, `winner-html`, and `json-download`. Comparison and gallery iframes are interactive immediately. Escape returns focus to a stable parent control without disabling iframe interaction.

The postMessage transport supports exactly `inspect`, `move`, `reset` and `undo`; `shift` is a direct `window.demo` helper, not a postMessage operation. Candidate revisions are independent of tournament, appearance and reviewer revisions. A failed message returns `{protocol,requestId,ok:false,error}` and does not authorize replay against a newly inferred revision.

The browser opens a comparison immediately, or resumes the session in its URL. Tall candidate scenes occupy nearly the full desktop width; choose buttons sit above each scene, notes and shared feedback/save/undo tools below. **More** exposes All candidates, Rankings, Export JSON, Sessions and Chrome mockups; Sessions is not an initial gate. Discovery and inspect control descriptors publish shortcuts: Left/Right choose, S skips, H hates both, and L likes both. Scoring shortcuts are inactive in text inputs, textareas, selects, editable text and the More menu, while saving/recovering, or while focus is inside an iframe. Repeated, composing and Alt/Ctrl/Meta-modified events do not score.

In the comparison shell, Tab focuses `pair-note`, then Tab again blurs it; Shift+Tab, appearance controls and the More menu preserve regular navigation. Candidate iframe controls keep their own keyboard handling. The browser main-world interface `window.tournament.inspect()` reports `focusedControl`, `focusedFrame`, `textEditing` and `shortcutsAvailable`; `window.tournament.toggleFeedbackFocus()` targets the real feedback field and returns whether it is now focused. `window.tournament.focusComparison()` returns focus from a demo to the parent controls and reports success. `window.tournament.feedback('skip'|'like-both'|'hate-both')` uses the same guarded persistence path as the buttons. Agents recording outcomes must still use rehearsal sessions.

The remaining main-world helpers are `window.tournament.choose('left'|'right')` and `window.tournament.saveNotes()`. Choose and feedback use the current pair and pending drafts, waiting for persistence; saveNotes writes candidate drafts without voting or committing a comparison reason. Inspect `state`, `view`, `busy`, `dirtyNotes`, `comparisonNotes` and `pending` afterward rather than assuming an action was accepted. These UI helpers do not accept an exact-revision envelope; use the HTTP/CLI interface for durable agent decisions, and never invoke a preference-writing helper on a human session.

`window.tournament.inspect().comparisonInteraction` reports `{available, hoveredSide, focusedSide, emphasizedSide}` from the real comparison DOM. Sides are `left`, `right` or `null`; the state is unavailable outside comparison. On hover-capable devices the hovered half takes precedence over focus in the other half; otherwise keyboard/iframe focus determines the emphasized half. Touch/no-hover devices use focus only. The cue changes only the Folio background and frame edge—not the candidate document, notes, selection or ranking. There is no mutation endpoint for synthetic hover: target the actual semantic control or iframe through the browser, then inspect the observed state. Appearance changes preserve the candidate’s own interaction state.

### Compact navigation

`GET /api/v2/discover` publishes `navigation`. Inspect `window.tournament.inspect().navigation` for the stable `navigation-toggle` summary, its expanded state, available controls and page-local revision. Open the actual More menu before targeting a hidden navigation action:

```js
const navigation = window.tournament.inspect().navigation;
const result = window.tournament.setNavigation({expectedRevision: navigation.revision, open: true});
```

The setter returns structured success/error state, rejects stale revisions and malformed requests, and changes only the native disclosure—not the comparison, notes or candidate frames. The revision is independent of appearance and tournament revisions. Native summary activation and Tab work normally; Escape closes the menu and returns focus to its summary, and clicking outside closes it. Menu keystrokes never record a vote. After navigation re-renders a view, inspect again rather than retaining old controls or revisions.

## Live appearance

The live app at `/` uses the approved **Things Folio** chrome. `GET /api/v2/discover` advertises `appearance`; the browser API is `window.tournament.appearance`, protocol `this-or-that/appearance/v1`. No appearance HTTP mutation route is added. Appearance is browser-local, separate from server ranking permissions and tournament revisions. Use a rehearsal session (`/?rehearsal=1`) when exercising comparison behavior.

```js
const appearance = window.tournament.appearance;
const before = appearance.inspect();
const change = appearance.wait({afterRevision: before.state.revision, timeoutMs: 1000});
const result = appearance.act({expectedRevision: before.state.revision, mode: 'dark'});
console.log(result, await change);
```

`discover()` publishes modes and request schemas. `query()` and `inspect()` expose mode (`system`, `light`, `dark`), resolved appearance (`light`, `dark`), page-local revision, persistence (`default`, `saved`, `unavailable`) and structured errors; inspection includes the stable `appearance-mode` combobox. `window.tournament.inspect().appearance` also exposes appearance state. `diagnose()` reports availability and persistence limitations without modifying preferences.

`act({expectedRevision,mode})` takes the currently inspected **appearance** revision, rejects stale or malformed requests without mutation, and uses the same update path as the visible Appearance selector. `wait({afterRevision,timeoutMs})` observes an appearance revision change or timeout; inspect its result rather than assuming a change. Revisions are not durable across reloads. `tournament:appearance` signals changes. A theme change updates chrome and its controls in place: candidate frame documents, scratch state, unsaved notes, focus and comparison state are not reset.

System follows `prefers-color-scheme`; explicit Light/Dark ignores OS changes. `localStorage['tot-appearance']` stores only the mode, shared through same-origin storage events. A blocked read/write is reported as `unavailable`, with an on-screen message; the selected page-local mode remains usable. Restore browser storage access and select again to retry saving. Select System to follow the OS again; remove only `tot-appearance` to reset storage, never tournament drafts or saved records. Appearance controls keep standard native-select arrows and Tab navigation; they never vote.

The eighteen `/mockups` studies remain independent historical previews; changing their selection neither changes this preference nor applies another live design.

## Chrome mockups

Run `bun run start`, then open `http://127.0.0.1:8477/mockups` (or **Chrome mockups** in the app). The existing server serves the reviewer, designs, candidates and local fonts; no additional services are needed. If the running server predates these routes, stop it with Ctrl-C/SIGTERM, wait for exit, then start it again. Preserve saved tournament records.

`GET /api/v2/discover` publishes additive `chromeMockups` metadata; tournament and candidate protocols are unchanged. `/mockups.json` uses `this-or-that/chrome-mockups/v2`, with `defaultId: "capture-lightbox"`, six `groups` and eighteen `options`: three independent designs each for Capture One, Figma, Linear, Things, Raycast and iA Writer. Each option supplies `id`, `name`, `number`, `family`, `familyId`, `typeface`, `description`, `src` and `reference`. See [all eighteen direct links](../README.md#chrome-mockups); `/mockups#capture-lightbox` opens the default design.

One full-size design is mounted at a time in `#design-preview`. Left/Right and previous/next buttons wrap across the whole catalog; the current design's selection dropdown jumps directly. **Copy link** shares the hash URL, with a selected URL field for manual copying if clipboard access fails. Unmodified, non-repeated, non-composing arrows browse on non-editable surfaces, including inside the nested previews; text fields, selects, editable content and specialized keyboard widgets retain their arrows. Escape focuses the review navigation. Arrows here never vote.

### Reviewer interface

The stable main-world object is `window.chromeMockups` on `/mockups`:

```js
const api = window.chromeMockups;
console.log(api.discover());
const before = api.inspect();
if (before.ok && before.state.ready) {
  console.log(api.act({
    expectedRevision: before.state.revision,
    action: 'select',
    id: 'figma-canvas'
  }));
}
console.log(api.inspect()); // Check state.previewStatus separately from state.ready.
```

- `discover()` publishes operations, action/wait schemas, groups, controls and limits.
- `query()` returns `{ok, protocol, state}`. State includes `ready`, `revision`, `selectedId`, zero-based `index`, `total`, `selection`, `options`, `previewStatus` and `lastError`.
- `inspect()` adds `controls`, `focusedControl`, `limits` and `preview` (`selector`, `src`, `status`, nested `sample`, runtime and reset scope).
- `act({expectedRevision, action, id?})` supports `select`, `next`, `previous` and `focus-review`. Every action requires the exact current non-negative integer revision. `select` also requires a catalog ID; next/previous wrap; focus-review focuses the Next design button. Selecting the current ID or focusing review does not increment revision or reload the preview.
- `wait({afterRevision, timeoutMs})` waits for a newer reviewer revision, not preview readiness. Supply an observed non-negative integer revision; timeout defaults to 10000 ms and accepts 0–30000. Success includes `changed` and `timedOut`; timeout is not a mutation or retry.
- `diagnose()` reports `healthy`, `problems`, current preview details and limits. It observes only; it does not repair or reload anything.

Reviewer revisions cover catalog availability and selection, **not** iframe loading or local sample changes. `state.ready` means the catalog is available; `state.previewStatus` is `unavailable`, `loading`, `ready` or `failed`. After selecting, inspect/query again until the preview is ready or failed rather than treating `wait()` as a frame-load barrier. `chrome-mockups:change` likewise signals reviewer changes, not every preview-status transition. Revisions are page-local, not durable tokens across reloads.

Malformed requests, unknown actions/IDs, unavailable catalogs and stale revisions return structured `{ok:false, protocol, error:{code,message}, state}` results without selecting another design. Inspect before a new decision; do not silently rebase a stale action. A missing hash opens the default. An invalid initial hash falls back to the default and reports `INVALID_ID`; an invalid later hash keeps the current selection and restores its URL.

### Nested local sample interface

Once `state.previewStatus === 'ready'`, the selected iframe exposes its own stable `window.chromeDesign`, protocol `this-or-that/chrome-design/v1`. This is separate from `window.chromeMockups` and the unchanged candidate protocol. The reviewer includes its inspection in `inspect().preview.sample`; same-origin automation can access it directly:

```js
const review = window.chromeMockups.inspect();
if (review.state.previewStatus === 'ready') {
  const sample = document.querySelector('#design-preview').contentWindow.chromeDesign;
  const current = sample.inspect();
  console.log(sample.act({
    expectedRevision: current.state.revision,
    action: 'note',
    side: 'left',
    text: 'Local sample annotation'
  }));
}
```

`chromeDesign.discover()` describes available controls and schemas; `query()` returns local state (`designId`, `ready`, `revision`, `response`, `notes`, `panels`); `inspect()` adds controls, candidate frame descriptors and limits. `act()` requires the **nested runtime's** current `expectedRevision`, not the reviewer revision:

- `vote` with `value: 'left' | 'right' | 'skip' | 'like' | 'hate'` selects a sample response.
- `note` with an available `side: 'left' | 'right' | 'pair'` and string `text` updates a sample note. Pair notes are optional; inspect controls first.
- `reset` clears sample notes and response, not candidate demo state or panel expansion.
- `toggle-panel` with the exact available panel `id` toggles that design's optional panel.

Nested `wait({afterRevision, timeoutMs})` uses the same 0–30000 ms range and 10000 ms default, but observes local runtime readiness, notes, responses and panel changes. `chrome-design:change` carries that local state. `diagnose()` checks runtime readiness and required sample hooks; it does not certify that both candidate apps have finished loading. Candidate scratch actions use their own unchanged interface and revision. Do not reuse an iframe API reference, revision or pending wait after switching designs: reacquire the current frame and inspect it.

### Preview limits and recovery

Selection is page-local and hash-addressable; there is no HTTP selection/mutation endpoint. Sample notes, responses and candidate demo interactions are memory-only and reset on design switch, reload or preview retry. No rankings, sessions or persistent preferences are written by the reviewer, and browsing does not switch live chrome. Things Folio was explicitly selected and integrated separately. Do not infer preferences from navigation or sample feedback.

A preview load has a 20-second deadline. A failure exposes **Try again**, which reloads the current preview (or retries the catalog when it is unavailable); selecting another design is also possible while the catalog is ready. There is no API retry action, and selecting the same ID is a no-op, not recovery. Use the real retry button or reload the page, then inspect readiness again. Do not delete ranking records to recover a preview.

## Limits and recovery

2–200 candidates; IDs are unique 1–80-character letters/digits/underscores/hyphens, names are nonblank and at most 200 UTF-16 units, and sources must be existing `/candidates/NAME.html` files. Note text is at most 20,000 UTF-16 units; request bodies are limited to 1 MiB. Saved state is serialized and atomically renamed in `TOURNAMENT_DATA_DIR` (default `.tournament-data`). Single process lock. Shut down with SIGTERM and wait. Preserve records and inspect the recorded process before removing a crash-stale lock. Legacy winner-only tournament records normalize on load without replacing saved evidence. No fixed-A/B record import, cloud access, authentication, untrusted upload sandbox or production-readiness claim. Current Folio/reviewer e2e coverage and separate historical unit/server coverage are described in [the README](../README.md#checks-and-test-scope); old test counts do not certify the live app.
