# This or that — Things Folio ranking

Compare, annotate and rank many candidates in the approved **Things Folio** app. The current collection contains **22 runnable sprint-planning UI directions**: two incumbent widgets plus 20 independent exploration drafts. Candidate demos remain exploratory; the selected comparison chrome is the live application.

## Install and start

Requires **Bun 1.3.14 or newer** and access to the private [johnlindquist/this-or-that](https://github.com/johnlindquist/this-or-that) repository.

```sh
git clone https://github.com/johnlindquist/this-or-that.git
cd this-or-that
bun install
bun run start
```

Open **http://127.0.0.1:8477**. `bun run start` runs the standalone `tournament/server.ts`; no parent checkout or additional service is required. Startup bundles the candidate helpers locally. The server never opens a desktop browser.

## Things Folio appearance

The live app uses the selected **Things Folio** design: nearly full-width, equal side-by-side previews with much taller interactive scenes. Each candidate has its choice button above the scene and annotations below; shared feedback, Save notes and Undo response follow the pair. **More** holds All candidates, Rankings, Export JSON, Sessions and Chrome mockups, leaving the header compact. On narrow screens the reading paths stack. Candidate demos themselves are unchanged.

Hover a candidate’s half to give its surrounding Folio surface a subtle blue (left) or clay (right) tint. Keyboard focus uses the same cue; pointer hover takes precedence when moving between the two. The cue is not a selection or vote and never rethemes the embedded design. Labels and controls use a slightly roomier, consistent spacing and type scale while keeping the previews large.

Use **Appearance → System / Light / Dark** in the header. System follows your OS; an explicit choice is saved in this browser and shared across same-origin tabs. Switching appearance does not reload candidates, discard notes or change rankings. If browser storage is blocked, appearance still works for this page and reports that it could not be saved. Select **System** to resume automatic appearance; removing the browser-local `tot-appearance` entry resets the preference without touching session drafts or server records. Automation uses `window.tournament.appearance` ([agent contract](docs/AGENT_API.md#live-appearance)).

## Chrome mockups

With `bun run start` running, open **http://127.0.0.1:8477/mockups** or **Chrome mockups** in the app navigation or Sessions view. The reviewer shows **one full-size preview** from eighteen independently authored designs: three each led by Capture One, Figma, Linear, Things, Raycast and iA Writer references. They vary workspace layout, typography and control placement—not just colors. The embedded Blueprint workbench and Team routes candidates stay unchanged.

Use **Left / Right** or the previous/next buttons to browse all eighteen designs, wrapping at either end. Open the current design's **selection dropdown** to jump directly. Arrows in text fields, selects, editable content and specialized keyboard widgets keep their normal behavior, including inside the candidate demos. Modified, held/repeated and composing keys do not navigate. **Escape** returns focus to the review navigation. Here arrows browse chrome; they never vote.

| Reference family | Direct preview links |
| --- | --- |
| Capture One | [Lightbox](http://127.0.0.1:8477/mockups#capture-lightbox) · [Session](http://127.0.0.1:8477/mockups#capture-session) · [Proof](http://127.0.0.1:8477/mockups#capture-proof) |
| Figma | [Canvas](http://127.0.0.1:8477/mockups#figma-canvas) · [Inspect](http://127.0.0.1:8477/mockups#figma-inspect) · [Deck](http://127.0.0.1:8477/mockups#figma-deck) |
| Linear | [Review](http://127.0.0.1:8477/mockups#linear-review) · [Triage](http://127.0.0.1:8477/mockups#linear-triage) · [Focus](http://127.0.0.1:8477/mockups#linear-focus) |
| Things | [Today](http://127.0.0.1:8477/mockups#things-today) · [Folio](http://127.0.0.1:8477/mockups#things-folio) · [Split](http://127.0.0.1:8477/mockups#things-split) |
| Raycast | [Command](http://127.0.0.1:8477/mockups#raycast-command) · [Shelf](http://127.0.0.1:8477/mockups#raycast-shelf) · [Spotlight](http://127.0.0.1:8477/mockups#raycast-spotlight) |
| iA Writer | [Manuscript](http://127.0.0.1:8477/mockups#writer-manuscript) · [Margin](http://127.0.0.1:8477/mockups#writer-margin) · [Contrast](http://127.0.0.1:8477/mockups#writer-contrast) |

**Copy link** shares the selected `/mockups#<id>` URL; if clipboard access fails, a selected URL field lets you copy manually. Without a hash, the default is `capture-lightbox`. These are **preview-only**: sample notes, responses and demo interactions reset when you switch designs or reload. Browsing does not record rankings, change saved sessions, persist a preference or switch the live app's design. Things Folio was explicitly selected and integrated separately.

The catalog is `/mockups.json`; automation uses v2 `window.chromeMockups` and the selected frame's local `window.chromeDesign` interface (see [the agent API](docs/AGENT_API.md#chrome-mockups)). The existing server serves everything, including fonts; no additional services are needed. If it predates these routes, stop it with Ctrl-C/SIGTERM, wait for exit, then run `bun run start` again. A failed preview offers **Try again**, or you can select another design; preserve saved records when restarting.

## Compare

1. Open the app to compare immediately—there is no start screen. A URL containing a session ID resumes that session. **Sessions** lists saved comparisons and offers **New comparison**.
2. Press **Left / Right** to choose the candidate on that side. The next pair appears immediately after the choice is saved.
3. Optionally leave candidate-specific notes or a reason for the current matchup.
4. Use the embedded demos directly: click, scroll and manipulate their controls without enabling a mode or opening another tab. Gallery previews are interactive too. **Esc** inside a demo returns focus to the comparison controls without locking the demo. Scoring shortcuts pause in text fields and while focus is inside a demo. In the comparison shell, **Tab** focuses/leaves feedback; **Shift+Tab** keeps normal navigation. Appearance controls retain normal Tab and arrow-key navigation.
5. **S — Skip** advances without score changes. **L — Like both** adds 16 points to each candidate. **H — Hate both** subtracts 16 from each. All three save notes and can be undone; neither shared outcome invents a winner or loser. Holding a key never submits repeated responses.
6. Continue through the stages to finish the pass. **Undo response** reverses an accidental response. Equal scores share a rank; skipped-only candidates remain unassessed.
7. Export **winner HTML**, the complete **JSON agent package**, or **Markdown notes**. Another ranking pass keeps the notes and earlier comparison evidence.

The merge-style schedule organizes matchups; **ranking score = Elo + 16 × (likes − hates)** determines the standings. Left/right choices update Elo. Skip changes no score. Like both and Hate both affect both equally, without a head-to-head win or loss. Completed ties share a rank, and unassessed candidates cannot win. Winner HTML is available only for a unique highest-scoring assessed candidate. Existing choices and notes are retained; current standings are recalculated under this scoring rule. This is a preference record, not statistical proof of quality.

## Notes and recovery

Candidate notes persist across matchups. Typing saves a recovery draft in this browser; **Save notes**, a comparison response, or export writes those candidate notes to the server. A comparison reason is saved with its response. The status distinguishes local drafts from saved responses. Reload resumes the same session. An uncertain request can be retried with its exact ID; it is not silently rebased.

Demo assignments and priority moves are scratch interactions; they reset when that candidate reloads. They do not alter rankings or candidate source. Notes and comparison responses are stored separately in `.tournament-data/`.

## Files and more variations

- `tournament/candidates/`: 22 independent HTML demos.
- `tournament/options.json`: collection names, descriptions and local source URLs.
- `tournament/candidate-kit.ts`: the shared eight-ticket fixture and move/undo/reset interface, using the existing movement reducer.
- `tournament/ranking.ts`: pair scheduling, ordering and match ratings.
- `tournament/server.ts`: saved sessions, agent API and source exports.
- `shared/`: required fixture, movement reducer and types used by the live candidate helpers.
- `web/widgets/` and the `web/` stylesheets: required incumbent widget implementations and CSS; these are not disposable legacy assets.
- `server/` and the unused `web/` SPA entrypoints: retained historical fixed-A/B source, not the live server or supported routes.
- `skills/this-or-that/`: installable agent instructions; the live HTTP/CLI and browser contracts are in [docs/AGENT_API.md](docs/AGENT_API.md).

Add more HTML demos to `tournament/candidates/`, then edit `tournament/options.json` or use **Use another collection** to paste `{ "title": "…", "options": [{ "id": "unique", "name": "…", "src": "/candidates/name.html" }] }`. Supports 2–200 local HTML candidates. A candidate may render a visual, a working UI, an API explorer, or another comparable artifact. Local candidate code is trusted; this is not an upload sandbox.

## Agent interface

```sh
bun run agent -- discover
bun run agent -- list
bun run agent -- create --mode rehearsal
bun run agent -- inspect --session UUID
bun run agent -- export --session UUID --format json
```

Discovery supplies the versioned schemas, available operations and candidate interfaces. Agents may inspect/export human comparisons, but can only create or mutate **rehearsal** sessions. The local actor label is a convention, not authentication. See [the agent API](docs/AGENT_API.md).

## Run and stop safely

The server binds only `127.0.0.1`; use that hostname, not `localhost`. Set `PORT` and `TOURNAMENT_DATA_DIR` for an isolated instance. Send SIGTERM/Ctrl-C and wait for exit. If a crash leaves `.lock`, verify its recorded process has exited before removing **only that lock**. Never delete preference records as a restart workaround. Export before changing candidate sources.

## Checks and test scope

```sh
bun run check
bun run test
bunx playwright install chromium
bun run test:e2e
```

- **`check`** type-checks `tournament/**/*.ts` together with the existing shared, historical server/web, scripts and test TypeScript sources. It does not certify browser behavior.
- **`test`** runs `tests/unit` and `tests/server`: retained reducer, fixed-A/B server/API and skill-installer coverage. These tests remain useful but do not verify the live tournament app.
- **`test:e2e`** selects only `tests/e2e/chrome-review.spec.ts` and `tests/e2e/folio-live.spec.ts` (nine tests). They cover the eighteen-design reviewer and current Folio appearance, navigation, side emphasis, draft preservation and comparison feedback. Other retained e2e sources target the historical fixed-A/B app and are excluded from this default; they do not certify the current app.

By default Playwright starts `bun tournament/server.ts` on **127.0.0.1:8478** with `TOURNAMENT_DATA_DIR=.data-e2e/tournament`, waits for `/api/v2/discover`, refuses server reuse, and stops it with SIGTERM (five-second shutdown timeout). This keeps test sessions separate from normal port 8477 and saved preferences. `PW_EXECUTABLE_PATH` can select an existing Chromium-compatible executable instead of the installed Playwright browser.

An explicitly supplied `TOT_BASE_URL` skips automatic server startup. Use it only for an independently isolated tournament server, never an instance holding real user data:

```sh
TOT_BASE_URL=http://127.0.0.1:8478 bun run test:e2e
```

These commands describe available coverage, not a claim that checks were run for every documentation or publication change. They do not production-certify all candidate demos.

## Historical and private local material

Earlier fixed-A/B lesson/recording materials and distribution archives are local history, not setup prerequisites or current workflow instructions. Historical test counts in the changelog describe those revisions only. The approved Folio appearance, large previews, friendly spacing and side emphasis do not replace or retheme any of the 22 candidate designs.

Saved preferences, scratch data, research notes, recordings, review captures, local result records, generated builds and dependency directories are excluded from publication. Keep them locally; do not delete records as cleanup. The repository retains the normative design record and bundled font assets/licenses, but does not bundle private evidence or historical distribution downloads.
