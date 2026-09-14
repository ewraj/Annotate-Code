# AnnotateCode — Implementation Plan

Companion to `ANNOTATECODE_PRODUCT_GIST.md`. The gist defines **what** the product is
and refuses to be; this document defines **how** it gets built, in what order, and
which decisions are expensive to reverse.

Status: **Phase 0 built, awaiting the Pages source switch.** Vite + React + TS scaffold,
IndexedDB schema, the anchoring ladder (34 tests), and the tool palette are in `src/`.
Live landing page at https://annotatecode.com, still served by the legacy root build.

---

## 0. How to read this

- **Sections 1–3** are decisions. Change them now if you disagree — they are cheap today
  and expensive after Phase 2.
- **Sections 4–10** are the design of the machine.
- **Section 11** is the phase-by-phase build order with acceptance criteria.
- **Sections 12–14** are testing, risks, and the questions I could not answer for you.

The governing test from the gist applies to every line below:

> Does this make reading and understanding code better?

---

## 1. The non-negotiables

Five constraints from the gist drive nearly every technical choice. Everything else is
negotiable; these are not.

| # | Constraint | Consequence |
|---|---|---|
| 1 | Code + ink must behave as **one document** | We cannot use a component that owns its own scroller opaquely |
| 2 | **Tablet + stylus** is a first-class target | Rules out desktop-only editor internals and mouse-only input handling |
| 3 | Annotations anchor to **code**, not viewport pixels | Anchoring schema must exist before the first stroke is ever saved |
| 4 | **Never silently move** someone's handwritten note | Anchoring needs an explicit *unresolved* state, not a best guess |
| 5 | Performance over feature count | Virtualized text, culled ink, lazy grammars, no main-thread blocking |

---

## 2. Technology decisions

### 2.1 Editor core — CodeMirror 6 (not Monaco)

**Decision: CodeMirror 6.**

The repo currently contains a two-line stub importing `@monaco-editor/react`. I recommend
deleting it. Reasons, in order of weight:

1. **Monaco is not supported in mobile browsers** — this is stated in Monaco's own
   documentation, not a rumour. The gist's flagship scenario is annotating a repo on an
   iPad with a stylus. That scenario cannot be built on Monaco.
2. **Monaco owns its pointer and scroll pipeline.** Constraint #1 requires ink and text to
   share a scroll coordinate space. Monaco can be coerced into this via overlay widgets and
   view zones, but you are fighting the framework at every step.
3. **Weight.** Monaco is on the order of megabytes; CodeMirror 6 with a handful of
   languages is a fraction of that. Section 9 sets a performance budget that Monaco makes
   hard to hit on a tablet.
4. **CodeMirror already has the primitives we need**, named below.

| We need | CodeMirror 6 primitive |
|---|---|
| Highlighter marks | `Decoration.mark` |
| Code Space (Phase 5) | `Decoration.widget({ block: true })` + `WidgetType` |
| Line geometry for anchoring | `view.lineBlockAt(pos)`, `view.coordsAtPos(pos)` |
| Hit-testing ink to a code position | `view.posAtCoords({x, y})` |
| Read mode | `EditorState.readOnly.of(true)` |
| Scroll container to sync ink against | `view.scrollDOM` |
| Redraw ink only when needed | `ViewPlugin` + `update.viewportChanged` / `update.geometryChanged` |
| Lazy grammars for many languages | `@codemirror/language-data` (`.load()` per language) |

**What we give up:** Monaco's TextMate grammar breadth and its IntelliSense. We do not want
IntelliSense — the gist forbids IDE features. Grammar breadth is the real cost, and
`@codemirror/language-data` covers every language the gist names.

**Rejected alternative — static highlighting (Shiki/Prism) with an editor only in edit
mode.** Tempting for a reader, and it would give total DOM control. Rejected because
maintaining two rendering paths for the same file guarantees they drift, and edit mode is
in the MVP anyway. One document model, one renderer.

### 2.2 The rest of the stack

| Concern | Choice | Why |
|---|---|---|
| Build | **Vite** + TypeScript | Fast, and multi-page support (see §10) |
| UI | **React 18** | Already the assumed direction; ecosystem for the tree view |
| State | **Zustand** | ~1kb, no provider ceremony. Redux is overkill for a single-document app |
| Storage | **IndexedDB via `idb`** | Only browser store that holds a repo's worth of text. `idb` is a thin promise wrapper, not an ORM |
| Ink geometry | **`perfect-freehand`** | Pressure-variable stroke outlines that actually feel like a pen. Writing this by hand is a week you don't need to spend |
| Routing | **Minimal — `react-router` or hand-rolled** | Two routes. Do not install a framework for this |
| Tests | **Vitest** + **Playwright** | See §12 |

Dependency discipline: the gist says the product wins by being *simple, fast, pleasant,
obvious*. Every dependency added past this table needs a reason written down.

---

## 3. Architecture principle

The gist is explicit — treat the codebase as a **document**, not a project.

```
Codebase (a "source")
  └── File
       ├── Source text
       ├── Annotations (ink, highlights, notes)
       ├── Bookmarks
       └── Reading position
```

Concretely this means:

- The **document is the primary object**, and annotations are a property of it — not a
  separate overlay app that happens to sit on top of code.
- Nothing in the annotation layer may depend on viewport pixels, window size, or scroll
  offset. Those are render-time inputs, never stored state.
- Every persisted record carries an `id` and `updatedAt` from day one, so that Phase 6 cloud
  sync is a transport change rather than a rewrite.

---

## 4. Data model

This is the most important section. Get it wrong and Phase 4 becomes a migration project.

```ts
type SourceKind = 'local-fs' | 'local-upload' | 'github' | 'scratch';

interface Source {                  // one opened codebase
  id: string;
  kind: SourceKind;
  name: string;                     // "facebook/react" or "my-project"
  origin?: { owner: string; repo: string; ref: string };   // github only
  fsHandleKey?: string;             // key into the handle store (local-fs only)
  createdAt: number;
  lastOpenedAt: number;
}

interface FileEntry {
  id: string;                       // stable across renames
  sourceId: string;
  path: string;                     // "src/services/runner.ts"
  size: number;
  lang?: string;                    // resolved lazily from extension
  blobSha?: string;                 // github only - lets us skip refetch
  content?: string;                 // absent until loaded (lazy)
  edited: boolean;                  // user has local modifications
  contentHash: string;              // hash of content at last save
  updatedAt: number;
}

interface Layer {
  id: string;
  sourceId: string;
  name: string;                     // "My Notes", "Questions"
  visible: boolean;
  color?: string;
  order: number;
  updatedAt: number;
}

type Tool = 'pen' | 'highlighter';

interface Annotation {
  id: string;
  layerId: string;
  fileId: string;
  kind: 'ink' | 'note' | 'mark';
  anchor: Anchor;
  geometry?: InkGeometry;                 // kind === 'ink'
  text?: string;                          // kind === 'note'
  range?: { from: number; to: number };   // kind === 'mark' (highlight over text)
  style: { tool: Tool; color: string; width: number };
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
}

interface InkGeometry {
  points: Array<{ x: number; y: number; p: number }>;    // see §5 - LINE-RELATIVE
  bbox: { x: number; y: number; w: number; h: number };  // for cheap culling
}

interface Bookmark {
  id: string;
  sourceId: string;
  fileId: string;
  line: number;
  name?: string;
  color?: string;
  anchor: Anchor;
  createdAt: number;
}

interface ReadingPosition {
  sourceId: string;
  fileId: string;
  line: number;
  updatedAt: number;
}
```

### The `Anchor` type

This is the heart of constraints #3 and #4:

```ts
interface Anchor {
  line: number;              // 0-indexed line at time of creation
  lineHash: string;          // hash of that line's trimmed text
  contextBefore: string[];   // up to 3 preceding lines, trimmed
  contextAfter: string[];    // up to 3 following lines, trimmed
  symbol?: string;           // enclosing function/class name, when cheaply known
  resolved?: 'exact' | 'moved' | 'unresolved';   // computed at load, never stored
}
```

---

## 5. The anchoring engine

**Ink points are stored relative to the top-left of their anchor line**, not to the
document or the page. This single choice makes window resize, font-size change, sidebar
toggle, and Code Space insertion all free — you translate the stroke, you never recompute it.

A stroke spanning several lines anchors to the line under its **topmost point**. It is not
decomposed per line. This is deliberately simple and is good enough; revisit only if real
usage shows drift.

### Resolution ladder (run on file open)

Applied in order, first hit wins:

1. **Exact** — line N still hashes to `lineHash`. Result: `exact`.
2. **Local search** — scan ±50 lines for a line matching `lineHash`. Result: `moved`.
3. **Context match** — find the unique position where `contextBefore` and `contextAfter`
   both match. Result: `moved`.
4. **Symbol match** — if `symbol` is set and appears exactly once, anchor to it. Result:
   `moved`.
5. **Fail** — result: `unresolved`.

**Unresolved annotations are never drawn over code.** They collect in a "Displaced notes"
tray in the sidebar, showing their text or thumbnail and their original context, with a
manual "place here" action. This is constraint #4 and it is not optional — silently
misplacing someone's handwriting is the one unforgivable bug in this product.

Resolution is pure and synchronous over strings, so it is trivially unit-testable. It should
carry the densest test coverage in the codebase (§12).

---

## 6. Persistence

**IndexedDB**, one database, object stores mirroring §4: `sources`, `files`, `layers`,
`annotations`, `bookmarks`, `readingPositions`, `fsHandles`, `meta`.

Indexes needed: `files.by-source`, `annotations.by-file`, `annotations.by-layer`,
`bookmarks.by-source`.

Rules:

- **Write ink on stroke end**, not on every point. Debounce everything else at ~500ms.
- Call `navigator.storage.persist()` on first save so the browser does not evict a user's
  annotations under storage pressure. Surface `navigator.storage.estimate()` in settings
  once a source exceeds ~50MB.
- **Never store viewport state.** Reading position is a *line number*, not a scrollTop.
- `schemaVersion` on annotations; a `meta.dbVersion` record for migrations.
- Local File System Access handles persist in `fsHandles` and require `queryPermission()` /
  `requestPermission()` on reopen — a returning user gets a one-click re-grant, not a
  re-pick.
- Ship an **export-to-JSON** escape hatch early. It is the backstop for every storage risk
  in §14 and costs almost nothing.

---

## 7. The ink engine

Latency is the product. If drawing feels laggy, nothing else matters.

### Layered canvases

Three surfaces stacked over `view.scrollDOM`:

1. **Committed canvas** — all saved strokes in the viewport. Redrawn on scroll and viewport
   change only.
2. **Wet canvas** — the single in-progress stroke. Cleared and redrawn per pointer event.
3. **Hit layer** — not rendered; an in-memory spatial index (a simple grid bucketed by line
   range) for eraser hit-testing.

Never redraw committed history mid-stroke. That is the entire trick.

### Sizing

Canvases are **viewport-sized, not document-sized.** A 5,000-line file is far past the
~16,384px canvas dimension cap in Chrome (lower on iOS), so a document-sized canvas is not
merely wasteful — it silently fails. Render by translating the context by the current scroll
offset, and cull strokes whose `bbox` falls outside the visible band.

### Input handling

- `pointerdown` / `pointermove` / `pointerup` on the ink surface, with `setPointerCapture`.
- **`getCoalescedEvents()`** on every move — a stylus samples far faster than the frame
  rate, and without this you get visible polygons instead of curves.
- `{ desynchronized: true }` on the wet canvas 2D context to skip a compositor hop.
- `touch-action: none` on the ink surface while a tool is active, so drawing never scrolls.
- **Palm rejection:** once any `pointerType === 'pen'` event is seen in a session, ignore
  `pointerType === 'touch'` for drawing. Touch continues to scroll. Cheap, effective,
  standard.
- Pressure from `event.pressure`, fed to `perfect-freehand`. Fall back to a constant when a
  device reports 0 (most mice do).

### Tool semantics

| Tool | Behaviour |
|---|---|
| Pen | Freehand stroke, pressure-variable width, `perfect-freehand` outline |
| Highlighter | Two modes: a freehand translucent stroke (multiply blend), **and** text-range selection producing a `kind: 'mark'` annotation. The second is what makes highlights survive reflow perfectly |
| Eraser | Whole-stroke erase via the hit grid, not pixel erase. Pixel erase cannot be represented in a vector model |
| Undo / Redo | Command stack scoped to the current file, capped at ~100 entries, not persisted across reloads in Phase 2 |

### The tool palette — Apple's PencilKit model

**Decision: copy the structure and interaction model of Apple's tool picker** (`PKToolPicker`
— the palette in Pages, Freeform, Notes, and Markup), trimmed to this product's tool set.

This is not decoration. Three properties of that palette are exactly what a code reader
needs, and each is a decision we would otherwise have to make badly ourselves:

1. **It floats and docks.** It is a puck over the document, draggable to an edge, not a
   band that permanently steals height from the page. §10 already calls for the toolbar to
   collapse to a floating puck when a tool is active — this *is* that puck. The code stays
   the centrepiece.
2. **Attributes are progressive.** The palette shows tools and colours only. Width and
   opacity live in a popover you get by tapping the **already-selected** tool. Nothing is
   on screen until you ask for it, which is what the gist means by *quiet*.
3. **Everyone already knows it.** The gist's flagship user is someone on an iPad with a
   stylus. They have used this exact control. Zero learning cost is worth more than
   originality here.

#### Anatomy

Left to right, matching the reference:

```
┌────────────────────────────────────────────────────────┐
│  ↶ ↷ │  🖊 🖍 🧽  │  ● ● ● ● ◉  │  ⋯                   │
│ undo  │   tools    │ colours+custom│ overflow           │
└────────────────────────────────────────────────────────┘
```

| Region | Contents | Notes |
|---|---|---|
| Undo / redo | Two circular buttons | Always visible; the most-used controls on a tablet |
| Tools | Pen, Highlighter, Eraser | The gist's list. Lasso and ruler are **not** ours — see §13 |
| Colours | 5 swatches + 1 custom | Custom opens a wheel. Swatch row is per-tool: a highlighter remembers yellow while the pen remembers blue |
| Overflow | `⋯` | Layers, Code Space toggle, export. Keeps the puck short on phones |

#### Interaction rules (these are the ones that make it feel right)

- **Selected tool rises.** The active tool translates up ~10px out of the tray, with a
  spring, and its tip is tinted the current colour. This is the entire selection affordance
   — no highlight box, no border.
- **Tap the selected tool again → attributes popover.** Five discrete width steps rendered
  as actual stroke marks (thin line → thick blob), not a slider with numbers; plus an
  opacity slider drawn as a checkerboard-to-colour gradient with a circular thumb. Widths
  are per-tool and remembered.
- **Discrete widths, not continuous.** Five steps is a real usability decision, not a
  shortcut: it makes the choice repeatable across sessions and thumb-sized on a tablet.
- **Drag the puck to any edge to dock it**; double-tap or drag off-edge to collapse it to a
  small pill that expands on tap. Position persists per source.
- **Frosted background** (`backdrop-filter: blur()`), large corner radius, hairline border,
  soft shadow. This is the one place in the app where material is allowed — everything else
  stays flat per the gist's design rules.
- **Never modal.** The palette never blocks scrolling, and tapping code while a tool is
  active draws, it does not dismiss.

#### Ink appearance per tool

The palette is only half of it; Apple's tools also *render* distinctly. Match that:

| Tool | Rendering |
|---|---|
| Pen | Opaque, pressure-varies width, `perfect-freehand` outline, round cap |
| Highlighter | Translucent (~0.35 alpha), **multiply** blend, near-constant width, flat/chisel cap, and — critically — a text-range mode producing `kind: 'mark'` (§7 tool semantics) |
| Eraser | Whole-stroke, with the erase radius previewed as a ring under the cursor |

A **pencil** tool (grainy texture, pressure → opacity rather than width) is the obvious
fourth and it suits a study tool. It is deferred to after Phase 2 ships: it needs a texture
sampling pass that the other two do not, and it is pure upside, not a blocker.

#### Where this lands in the schedule

The palette is **Phase 2** work and ships with the ink engine. But build it as a **dumb
presentational component in Phase 0's shell** — tool state in Zustand, no drawing wired up.
It costs an afternoon, it makes the empty `/app` shell feel like the product, and it forces
the tool/colour/width state shape to exist before the ink engine assumes one.

---

## 8. Source adapters

One interface, four implementations. Everything upstream of the reader speaks this:

```ts
interface SourceAdapter {
  listFiles(): Promise<FileEntry[]>;      // tree only, no content
  readFile(id: string): Promise<string>;  // lazy, cached
  writeFile?(id: string, text: string): Promise<void>;
  createFile?(path: string): Promise<FileEntry>;
  deleteFile?(id: string): Promise<void>;
  renameFile?(id: string, path: string): Promise<void>;
}
```

### GitHub (no OAuth — the gist forbids it)

1. `GET /repos/{owner}/{repo}` — default branch. One request.
2. `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` — the whole tree. One request.
3. File content from **`raw.githubusercontent.com/{owner}/{repo}/{sha}/{path}`** — this is
   *not* the API, so it does **not** consume rate limit, and it sends permissive CORS
   headers.

That is **two API calls per repository**, regardless of repo size. This matters because
unauthenticated GitHub allows 60 requests/hour/IP. Using the contents API per file would
burn the quota in about a minute.

Handle `truncated: true` on the tree response (very large repos) by falling back to
per-directory tree fetches on expand, and telling the user the listing is partial.

### Local

- **`showDirectoryPicker()`** where available (Chromium): real read/write, handle persisted.
- **`<input webkitdirectory>`** fallback: read-only snapshot into IndexedDB, no write-back.
- Neither works on iOS Safari — see §14.
- Filter aggressively on import: skip `.git`, `node_modules`, binaries, and anything over
  ~2MB. Detect binary with a null-byte sniff over the first 8KB.

---

## 9. Rendering and performance budget

Numbers to hold ourselves to, on a mid-range tablet:

| Metric | Budget |
|---|---|
| Pointer-move to wet ink on screen | < 16ms |
| Scroll | 60fps sustained, no ink tearing |
| File open (cached) to first paint | < 150ms |
| Repo open (5,000 files) to tree visible | < 2s |
| Tree memory for 5,000 files | metadata only; content never eagerly loaded |

Techniques, all non-optional:

- CodeMirror already virtualizes text — do not defeat it by measuring every line.
- Ink culled by `bbox` against the visible band.
- Grammars lazy-loaded per language, on the first file of that type.
- File contents lazy-loaded and LRU-cached (cap ~50 files in memory).
- Hashing and whole-file anchor resolution move to a **Web Worker** past ~5,000 lines.
- Virtualize the file tree above ~1,000 nodes.

---

## 10. App shell, routing, deployment

### Layout (from the gist)

```
┌──────────────────────────────────────────────┐
│ toolbar: file · tools · layers · bookmarks   │  minimal, quiet
├───────────┬──────────────────────────────────┤
│ file tree │ code + ink  (the centrepiece)    │
│ (collapse)│                                  │
└───────────┴──────────────────────────────────┘
```

The sidebar collapses to a sheet on tablet and mobile. The toolbar collapses to a floating
tool puck when a drawing tool is active. Design language: white/off-white, thin borders,
small radii, very little colour — the existing landing page is the reference.

### Routing

- `/` — the current static landing page, kept **byte-for-byte** and instant.
- `/app` — the SPA.

Use **Vite multi-page** (two entry HTML files) rather than having React render the landing
page. The marketing page should not wait on a JS bundle.

### Deployment change (must happen in Phase 0)

Pages currently serves the repo root as static files (`build_type: legacy`). The moment
there is a build step, that breaks. Phase 0 must:

1. Add a GitHub Actions workflow (`configure-pages` → build → `upload-pages-artifact` →
   `deploy-pages`) and switch the Pages source from a branch to GitHub Actions.
2. Copy `CNAME` into `dist/` — otherwise the custom domain drops on the first deploy.
3. Emit `404.html` as a copy of the app shell, for SPA deep links.
4. Keep **Enforce HTTPS** on.

Regression check after the first Actions deploy: `https://annotatecode.com` still returns
200 and still serves the landing page, not the app.

---

## 11. Phases

Each phase ends at a state worth shipping. Nothing here requires everything before it to be
finished — only the phase immediately prior.

### Phase 0 — Foundation

*No user-visible change.*

- Vite + React + TS scaffold; delete the Monaco stub.
- Vite multi-page: landing at `/`, app shell at `/app`.
- GitHub Actions to Pages (§10), CNAME preserved, 404 fallback.
- IndexedDB schema and typed accessors for every store in §4.
- Annotation and Anchor types with `schemaVersion`, and the §5 resolution ladder **written
  and unit-tested now**, before anything depends on it.
- Zustand store skeleton; Vitest and Playwright configured in CI.
- The **tool palette as a presentational component** (§7) — tools, colours, width popover,
  docking, all driven by Zustand, with no drawing behind it yet.

**Done when:** the Actions deploy is green, the landing page is unchanged in production, and
`/app` renders an empty shell.

**Risk:** the Pages source switch briefly breaks the live domain. Do it in one commit and
verify immediately.

---

### Phase 1 — The reader

*First genuinely useful version.*

- `SourceAdapter` interface, plus the **GitHub adapter** and **local adapter** (§8).
- File tree: lazy, virtualized, filtered.
- CodeMirror in read-only mode: lazy grammars, line numbers, horizontal scroll, normal text
  selection.
- Reading position saved per file, restored on reopen.
- Recent sources list on `/app`.

**Deviation from the gist's MVP order, deliberately:** the gist lists local-codebase opening
in the MVP and GitHub-URL opening in the "later" pile. **Do GitHub first, in this phase.**
`showDirectoryPicker()` is Chromium-only and `webkitdirectory` does not work on iOS Safari,
so a local-only Phase 1 cannot run *at all* on an iPad — which is the gist's own flagship
scenario. GitHub-by-URL is also less code, and it is the better demo for a hosted site.

**Done when:** you can paste a GitHub URL on an iPad, browse the tree, read highlighted
code, close the tab, and come back to the same line.

---

### Phase 2 — Ink

*This is the product.*

- Three-surface canvas system (§7) bound to `view.scrollDOM`.
- Pen, highlighter (both freehand and text-range), eraser, undo/redo, wired to the Phase 0
  palette (§7) — per-tool colour and width now actually change the ink.
- Pointer/stylus pipeline: coalesced events, pressure, palm rejection, `touch-action`.
- Ink persisted on stroke end, anchored per §5, culled per §9.
- Displaced-notes tray for `unresolved` anchors.
- A default layer created implicitly — no layer UI yet.

**Done when:** you can annotate a file on a tablet with a stylus, scroll fast, and the ink
stays welded to the code — then reload and find it exactly where you left it.

**Risk — the highest in the project:** ink/scroll desync. Mitigate by binding redraws to
CodeMirror's own update cycle rather than to scroll events, and by testing on a real tablet
early in the phase, not at the end of it.

---

### Phase 3 — Editing

- Read-only off: CodeMirror editing enabled, dirty-state tracking, save through the adapter.
- Create, delete, rename files.
- **Re-anchor on edit** — run the §5 ladder against the changed document on save, and shift
  anchors by line delta live during a session.
- GitHub sources are read-only upstream: edits are local overlays on top of the fetched
  blob, clearly marked as such. No commits, no push. The gist forbids Git features.

**Done when:** you can fix a typo in a file you annotated and every annotation is still on
the right line.

---

### Phase 4 — Organisation

- **Layers**: create, rename, show/hide, delete, reassign. A simple list, no nesting.
- **Bookmarks**: named, coloured, anchored, jump-to.
- **Typed notes**: `kind: 'note'` annotations in the margin.
- **Annotation index**: search across notes and bookmarks in a source, click to jump.

Handwriting OCR is explicitly *not* here — see §13.

**Done when:** you can find a note you wrote last week by typing three words.

---

### Phase 5 — Code Space

- A toggle that injects block widgets between lines, expanding the annotation band.
- Per-file and persisted; ink written into a band anchors to the line above it.
- Adjustable band height; interacts with editing, so bands must survive line insertion.

The gist warns explicitly against over-engineering this early, and it is placed last among
the local features for that reason: it touches layout, ink, editing, scrolling, and resize
simultaneously. Do not attempt it before Phase 2 ink is stable.

---

### Phase 6 — Accounts, sync, sharing

- Auth plus cloud persistence. Because every record already carries `id` and `updatedAt`,
  this is a transport swap plus conflict resolution, not a rewrite.
- Last-write-wins per annotation is acceptable — annotations are small, independent, and
  rarely edited concurrently by one person across devices.
- **Sharing**: read-only publication of a source plus selected layers. The recipient cannot
  modify the owner's copy (gist requirement).
- Handwriting OCR (Tesseract.js in a worker) to make ink searchable. Genuinely optional.

---

## 12. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Anchor resolution | Vitest | The densest suite in the repo. Table-driven: line inserted above, line deleted, block moved, file rewritten, duplicate lines, whitespace-only change. Every case asserts `exact`/`moved`/`unresolved` **and** that nothing is silently misplaced |
| Data layer | Vitest + fake-indexeddb | Round-trip every store; migration from `schemaVersion` 1 |
| Adapters | Vitest with fetch mocks | GitHub tree parsing, truncated trees, rate-limit responses, binary filtering |
| Ink geometry | Vitest | Point transforms, bbox, culling, hit-testing |
| Scroll/ink sync | Playwright | Scroll a long annotated file, screenshot-compare ink position at intervals |
| Stylus feel | Manual, on a real tablet | Every phase. No substitute exists |

---

## 13. Deliberately deferred

Not "cut" — deferred with a reason, so they do not creep in early.

| Item | Why it waits |
|---|---|
| Handwriting OCR | Needs a real ink corpus to tune. Typed-note search delivers most of the value in Phase 4 |
| Symbol-aware anchoring (AST) | Requires per-language parsing. The four-step string ladder handles the common cases; buy the data before buying the complexity |
| Collaborative editing | Explicitly not the product |
| Multi-repo workspaces | Ambiguity in bookmarks and layers, no demonstrated need |
| Per-pixel eraser | Incompatible with a vector annotation model |
| Lasso / select, ruler, shape-snap | In Apple's palette, not in the gist's tool list. A ruler is for drawing; this product is for writing on code |
| Pencil tool (grainy texture) | Wants a texture pass the pen and highlighter don't need. Additive after Phase 2, not a blocker |
| Anything with a "Run" button | Forbidden by the gist |

---

## 14. Risks and open questions

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Ink/scroll desync feels janky | **Highest** | Bind to CodeMirror's update cycle, not scroll events. Test on a tablet from day one of Phase 2 |
| Anchor drift misplaces notes | High | Resolution ladder, explicit unresolved state, heaviest test suite |
| iOS Safari memory limits on large repos | Medium | Lazy loading, LRU cache, tree-only metadata |
| IndexedDB eviction loses annotations | Medium | `storage.persist()`, quota surfacing, export-to-JSON escape hatch |
| GitHub 60 req/hr limit | Medium | Two calls per repo, raw.githubusercontent for content, cache trees |
| Scope creep toward an IDE | Medium | §13 exists; re-read the gist's final test before adding anything |

### Open questions — these need your answers

1. **iPad local files.** No iOS browser supports directory picking, so on iPad the app is
   GitHub-and-paste only. Acceptable, or do you want a share-target / file-import path?
2. **Cloud backend for Phase 6.** You have a Supabase connector configured on this machine —
   is Supabase the intended backend? It would give auth, Postgres, and row-level security
   for sharing in one move.
3. ~~**App location.**~~ **Answered: `/app` on annotatecode.com.** Built as a Vite
   multi-page app; the landing page stays static and is verified byte-identical by the
   deploy workflow.
4. **Edited GitHub files.** Local edits to a fetched repo are overlays that can never be
   pushed back. Keep them, or make GitHub sources strictly read-only to avoid the dead end?
5. ~~**Landing page buttons.**~~ **Answered: wired in Phase 0.** "Open a codebase" links to
   `/app/`; "Paste a GitHub URL" passes the URL as `?repo=`, which Phase 1 will read.

---

## Appendix — concrete Phase 0 task list

1. `npm create vite@latest` — React + TS. Delete `CodeEditor.tsx`.
2. Move the landing page into the Vite multi-page setup; verify it builds byte-identical.
3. Add the Pages Actions workflow; switch the Pages source to Actions; verify the domain.
4. Install: `codemirror`, `@codemirror/{state,view,language,language-data,commands,search}`,
   `zustand`, `idb`, `perfect-freehand`.
5. Write `src/model/types.ts` — every interface in §4.
6. Write `src/model/anchor.ts` — the §5 ladder — and `anchor.test.ts` before it.
7. Write `src/db/index.ts` — stores, indexes, migrations.
8. Empty `/app` shell: toolbar, collapsible sidebar, empty centre pane.
9. `src/ui/ToolPalette/` — the §7 palette, presentational, state in Zustand.

---

*Read code. Annotate it. That's it.*
