# Phase 2 — Ink

*Companion to `IMPLEMENTATION_PLAN.md` §5, §7, §9. That document says what to build and
why. This one says how, against the code that now exists, and flags the decisions that
have to be made before the first line is written.*

**Phase 1 shipped and is live.** `main` is at `ef1848b`, the deploy is green, and
annotatecode.com/app/ serves the reader. Everything below builds on that tree.

---

## 0. The one idea

Ink is stored **relative to the top-left of its anchor line**, drawn on **viewport-sized
canvases** that never scroll, and redrawn by translating the context by the current scroll
offset. Every hard question in this phase — resize, font change, sidebar toggle, a 5,000
line file, Phase 5's Code Space bands — collapses into "translate the stroke" as long as
that rule holds.

The corollary is the thing to actually be disciplined about:

> **Never redraw committed history mid-stroke.**

If a `pointermove` handler ever touches the committed canvas, the phase has failed its
performance budget no matter what the profiler says afterwards.

---

## 1. Three coordinate spaces, named once

Most of the bugs in this phase will be a value from one space used in another. Name them
now and convert only through named functions.

| Space | Origin | Used for |
|---|---|---|
| **Line-relative** | top-left of the anchor line's text box | `InkGeometry.points`, `bbox` — **the only space that is persisted** |
| **Content** | top-left of CodeMirror's `contentDOM`, unscrolled | intermediate; what `lineBlockAt().top` speaks |
| **Surface** | top-left of the visible scroller box | what the canvas 2D context draws in |

```
surface = content − { x: scrollLeft, y: scrollTop }
content = lineOrigin(line) + lineRelative
```

Two functions, in `src/ink/coords.ts`, and nothing else converts:

```ts
/** Content-space top-left of a 0-indexed line. */
function lineOrigin(view: EditorView, line: number): { x: number; y: number };

/** Surface-space point for a line-relative point. */
function toSurface(view: EditorView, line: number, p: InkPoint): { x: number; y: number };
```

`lineOrigin` is `view.lineBlockAt(view.state.doc.line(line + 1).from).top` for `y`, and the
`contentDOM`'s left inset (the gutter width) for `x`. Both are cheap, but they are *not*
free — cache the gutter width per measure cycle, and never call `lineBlockAt` in a loop over
every annotation in a file. Call it once per *visible* anchor line, after culling.

**No line wrapping** is configured (`CodeView.tsx:63`), which is load-bearing here: one
document line is exactly one visual row, so a line-relative `y` is unambiguous. If wrapping
is ever turned on, this whole scheme needs revisiting.

### Capture in content space, immediately

A stroke in progress must have each point converted to content space **at the moment the
pointer event arrives**, not at `pointerup`. If a scroll lands mid-stroke — momentum, a
two-finger pan, a caret scroll — surface coordinates captured earlier become lies. Convert
on arrival, hold content-space points in the wet buffer, and rebase to line-relative once
at the end.

---

## 2. Where the canvases live

The plan says "stacked over `view.scrollDOM`". Mount them as **absolutely positioned
siblings of `.cm-editor` inside `.ac-codeview`**, not as children of the scroller.

Children of the scroller would have to fight scrolling with `position: sticky` and would be
dragged around by the browser's own scroll compositing — exactly the ink/scroll tearing this
phase is most at risk from. As siblings pinned over the scroller's box, they simply never
move; only their contents are redrawn.

```
.ac-codeview            position: relative
├── .cm-editor          the scroller (CodeMirror owns it)
└── .ac-ink             position: absolute; inset: 0; pointer-events: none
    ├── canvas.committed
    └── canvas.wet      { desynchronized: true }
```

- `pointer-events: none` on `.ac-ink` in reading mode, `auto` when a tool is armed. That
  single toggle is what keeps text selection and scrolling working when no tool is out.
- Size both canvases to the scroller's client box × `devicePixelRatio`, and re-size on
  `ResizeObserver`. A stale backing store is a blurry canvas, and on a tablet rotation it is
  a very obviously blurry one.
- The hit layer is **not a canvas.** It is an in-memory grid bucketed by line range, living
  in the same module. Nothing renders it.

### Wiring it up

`App.tsx:112` renders `CodeView` **without** `onScrollerReady` today — the prop exists and
is unused. That is the Phase 2 seam. `CodeView` should hand back the `EditorView` itself,
not just the scroller: the ink layer needs `lineBlockAt`, `posAtCoords`, and
`requestMeasure`, and reaching them through the DOM element would be worse.

> **Change `onScrollerReady?: (scroller: HTMLElement | null) => void` to
> `onViewReady?: (view: EditorView | null) => void`.** Do it as the first commit of the
> phase, on its own, so the rename is not tangled up in the ink diff.

---

## 3. The redraw cycle

The committed canvas is redrawn on viewport change, geometry change, document change, and
scroll — and on nothing else.

CodeMirror dispatches updates for viewport and geometry changes, but **not** for every
scroll within the already-rendered viewport, so a scroll listener is genuinely needed. The
plan's instruction to bind redraws to CodeMirror's update cycle rather than to scroll events
is still right, and the way to honour both is:

```ts
scrollDOM.addEventListener('scroll', () => view.requestMeasure(measureSpec), { passive: true });
```

`requestMeasure` runs the `read` phase inside CodeMirror's own measure cycle and the `write`
phase after it, which means ink is drawn against geometry CodeMirror has already settled —
never against a half-measured DOM. Multiple `requestMeasure` calls in a frame collapse into
one, so coalescing is free.

A `ViewPlugin` handles the rest:

```ts
update(u: ViewUpdate) {
  if (u.docChanged || u.viewportChanged || u.geometryChanged) this.view.requestMeasure(spec);
}
```

**Do not** redraw from a permanent `requestAnimationFrame` loop. If nothing changed, nothing
should be drawn, and a constant rAF loop on a tablet is a battery complaint waiting to
happen.

### Culling

Per redraw: take the visible line band from `view.viewport` (widened by a few lines of
overscan), take the annotations whose anchor line falls in that band, then reject any whose
`bbox`, translated to surface space, misses the visible rect. Both tests are integer
comparisons; the expensive part is `lineOrigin`, so do it once per distinct line.

---

## 4. Input

`pointerdown` / `pointermove` / `pointerup` on `.ac-ink`, with `setPointerCapture` on down.

- **`getCoalescedEvents()` on every move.** A stylus samples at 120–240Hz against a 60Hz
  frame; without this the curve is a visible polygon. This is not an optimisation, it is the
  difference between the product feeling right and feeling cheap.
- **Pressure**: `event.pressure`, clamped to `[0, 1]`. A device reporting exactly `0` on a
  `pointerdown` that clearly happened is reporting "unknown" — substitute a constant `0.5`.
  Most mice do this; some pens do it for the first sample of a stroke.
- **Palm rejection**: once any `pointerType === 'pen'` event has been seen in the session,
  ignore `pointerType === 'touch'` for drawing, permanently, for that session. Touch keeps
  scrolling. Keep the flag in the ink module, not in Zustand — it is not user state and it
  should not be persisted.
- **Thinning**: drop a coalesced point within ~1.5 CSS px of the previous one. Stroke
  fidelity is unaffected and the stored point count falls sharply on slow, deliberate
  annotation — which is most annotation.

### `touch-action` — a real discrepancy to settle

The plan (§7) says `touch-action: none` on the ink surface while a tool is active.
`app.css:192` currently ships `touch-action: pan-y` on `.ac-document.is-armed`.

These are different products. `none` means a finger cannot scroll while a pen is out — you
put the pen down to scroll. `pan-y` means a finger scrolls and only the pen draws, which is
how Procreate, Notes, and every iPad app a stylus user already knows behaves.

**Recommendation: keep `pan-y`, and treat the plan's `none` as superseded.** It composes
with palm rejection exactly right — touch scrolls, pen draws, and the two never contend. The
cost is that a *finger* can never draw once a pen has been seen, which is the intended
behaviour anyway.

Worth an explicit decision now, because the input pipeline is written differently for each
and retrofitting is unpleasant.

---

## 5. Rendering a stroke

`perfect-freehand` is already a dependency and currently unused.

```ts
const outline = getStroke(points, { size, thinning, smoothing, streamline, last });
```

`getStroke` returns an outline polygon, not a path — build a `Path2D` from it once and fill
it. Two notes that matter:

- Pass `last: false` while the stroke is wet and `last: true` on the final render. It
  changes how the tail cap is drawn; without it the committed stroke visibly differs from
  the wet one at the moment of release, which reads as a glitch.
- Cache the `Path2D` per annotation, keyed by annotation id and the current font size. The
  outline is in line-relative space, so scrolling does not invalidate it — only a geometry
  change does. Translate the context, then fill the cached path.

| Tool | Render |
|---|---|
| Pen | `globalCompositeOperation: 'source-over'`, full opacity, `thinning` driven by pressure |
| Highlighter (freehand) | `'multiply'`, opacity from `settings.highlighter.opacity` (0.35), `thinning: 0` — a highlighter has no pressure response |
| Highlighter (text range) | **not canvas at all** — see below |

### Highlighter over text is a different subsystem

A `kind: 'mark'` annotation is a CodeMirror `Decoration.mark` over a `{ from, to }` range,
rendered by the editor, not by us. It reflows perfectly because CodeMirror reflows it, which
is exactly why the plan wants it.

It shares the palette, the layer, and the `Annotation` record, and shares **nothing else**
with the canvas pipeline. Build it as its own small extension (`src/ink/marks.ts`), and
resist any urge to unify the two paths. They are the same data model and two entirely
different renderers.

Range marks need the anchor too — anchor to the line of `from`, so that a mark whose range
is invalidated by an edit in Phase 3 still has a line to fall back to.

---

## 6. Erasing

Whole-stroke erase via the hit grid. Never pixel erase — a vector model cannot represent the
result, so a pixel eraser would be a lie that survives until reload.

```ts
interface HitGrid {
  insert(id: string, line: number, bbox: Box): void;
  remove(id: string): void;
  near(line: number, point: Point, radius: number): string[];
}
```

Bucket by line range (say 16 lines per bucket). `near` collects candidate ids from the
buckets the eraser touches, rejects by `bbox`, and only then runs a real distance test
against the stroke's points. The eraser radius comes from `ERASER_WIDTHS[eraserWidthStep]`.

The eraser is a drag, not a tap: collect every id the drag passes over, delete them in one
`deleteAnnotations(ids)` call on `pointerup`, and push **one** undo entry for the whole drag.
Erasing forty strokes should take one undo to restore, not forty.

---

## 7. Persistence

On `pointerup`, and never before:

1. Take the topmost point of the stroke; `view.posAtCoords` → its document line. That is the
   anchor line. A stroke spanning several lines is **not** decomposed — plan §5 is explicit.
2. `createAnchor(toLines(text), line)` — `src/model/anchor.ts:71`. Leave `symbol` undefined
   for now; cheap symbol extraction is a Phase 4 concern.
3. Rebase the content-space points to line-relative by subtracting `lineOrigin(line)`.
4. Compute `bbox` over the rebased points, inflated by half the stroke width so culling
   never clips a fat stroke's edge.
5. `putAnnotation({ ... schemaVersion: 1 })` — `src/db/index.ts:228`, whose doc comment
   already says "Called on stroke end — never per pointer event."

On file open: `listAnnotations(fileId)`, then `resolveAnchor` each one against the current
document (`src/model/anchor.ts:147`) and hold the resulting line in memory. `Resolution` is
`{ line, resolved }`, and `resolved: 'unresolved'` is a **normal outcome, not an error** —
those go to the tray (§8), never to a guessed line.

### There are no layers yet

Every `Annotation` needs a `layerId`, and nothing in the tree creates a `Layer`. Phase 2
needs `ensureDefaultLayer(sourceId)`: look up `listLayers(sourceId)` and, if empty,
`putLayer({ name: 'Notes', visible: true, order: 0, ... })`. No layer UI — Phase 4 owns
that. Call it when a source is opened, not when the first stroke lands, so the first stroke
is never waiting on a database write.

### Resolution cost

`resolveAnchor` is pure and synchronous over strings, but it runs once per annotation and
each run can scan `SEARCH_RADIUS` lines. A file with 300 annotations is fine. Plan §9 moves
whole-file anchor resolution to a Web Worker past ~5,000 lines — **don't build the worker in
this phase.** Measure first; a `performance.mark` around the resolve pass on open is enough
to know whether it is ever a problem.

---

## 8. Displaced notes

Annotations that come back `unresolved` are the product's integrity promise made visible:
*never silently move someone's handwritten note to the wrong code.*

A tray — a small, quiet panel listing them by a thumbnail of the stroke and the code it was
written against (`anchor.contextBefore` / `contextAfter` are exactly that, already stored).
Clicking one offers to re-place it on the current line.

Keep it simple. It will be empty in almost every Phase 2 session, because nothing edits
files until Phase 3. It exists now so that Phase 3 does not have to invent it under
pressure.

---

## 9. Undo / redo, and a keymap collision

A command stack scoped to the current file, capped at ~100 entries, cleared on file switch,
not persisted across reloads.

Entries are coarse: one stroke, or one eraser drag. Each holds enough to reverse itself —
for a stroke, its id; for an erase, the full `Annotation` records, so redo can put them back.

**The collision:** `CodeView.tsx:64` installs `historyKeymap`, which binds `Mod-z`. In
read-only mode CodeMirror's history is inert, so an ink undo bound at the window level works
today. In Phase 3 it will not — editing turns CodeMirror's history back on and the two will
fight over the same chord.

Bind ink undo as a CodeMirror keymap at `Prec.highest`, conditional on a tool being armed,
returning `false` when no tool is out so the chord falls through to the editor. Getting this
right now costs ten minutes; getting it wrong costs a confusing bug in Phase 3.

---

## 10. File switching

`CodeView`'s document-swap effect (`CodeView.tsx:113`) replaces the whole document and sets
`scrollTop = 0`. The ink layer has to follow:

- Clear both canvases and the hit grid **before** the swap lands, not after. A frame of the
  previous file's ink over the new file's code is the kind of glitch people remember.
- Drop the `Path2D` cache.
- Load and resolve the new file's annotations, then request one measure.

The cleanest hook is the same `fileId` dependency the swap effect already uses — the ink
layer should key off `fileId` exactly as the editor does, and never try to infer a file
change from document content.

---

## 11. Budget

From plan §9, the two this phase owns:

| Metric | Budget |
|---|---|
| Pointer-move to wet ink on screen | **< 16ms** |
| Scroll | **60fps sustained, no ink tearing** |

Instrument both from the start, cheaply: a `performance.now()` delta from event timestamp to
draw, logged behind a dev flag. A budget nobody measures is a wish.

The four things that protect these, in order of how easy they are to lose:

1. Committed canvas untouched during a stroke.
2. `getCoalescedEvents()` on every move.
3. `desynchronized: true` on the wet context.
4. Culling by `bbox` before any per-point work.

---

## 12. Suggested commit order

Each of these is independently reviewable and leaves the tree working.

1. **`onScrollerReady` → `onViewReady`** in `CodeView`, wired through `App.tsx`. No ink yet.
2. **`src/ink/coords.ts`** — the three-space conversions, pure, unit-tested against a fake
   view. This is where the subtle bugs live, so it gets tests before it gets callers.
3. **Canvas mounting + redraw cycle** — `.ac-ink` layer, sizing, DPR, `ResizeObserver`,
   `requestMeasure` wiring. Draw a hardcoded debug rectangle pinned to line 10 and scroll it.
   If that rectangle stays welded to line 10 through fast scrolling, rotation, and a sidebar
   toggle, the hardest part of the phase is done.
4. **Wet stroke** — pointer pipeline, coalesced events, pressure, palm rejection,
   `perfect-freehand`. Draws and vanishes on release. Nothing persisted.
5. **Commit + persist** — anchor capture, line-relative rebase, `putAnnotation`,
   `ensureDefaultLayer`, load-and-resolve on open, committed-canvas render.
6. **Eraser + hit grid.**
7. **Undo / redo**, with the `Prec.highest` keymap.
8. **Text-range highlighter** — the `Decoration.mark` path.
9. **Displaced-notes tray.**

Steps 1–5 are the phase's spine; 6–9 each stand alone and could slip to a follow-up without
leaving anything broken.

---

## 13. Testing

**Unit (Vitest, no DOM needed)** — everything pure, and there is more of it than there looks:

- coordinate conversions, round-tripping line-relative → content → surface → line-relative
- `bbox` computation, including the half-width inflation
- point thinning
- hit-grid insert / remove / `near`
- undo-stack behaviour: cap, clear on file switch, erase-drag coalescing

**Component (jsdom)** — canvas is not meaningfully testable in jsdom; don't pretend. Assert
the wiring instead: canvases mount and unmount with the view, `pointer-events` flips with
`activeTool`, and the layer clears on `fileId` change.

**Real device — not optional, and not at the end.** Plan §11 calls ink/scroll desync the
highest risk in the project and says to test on a real tablet *early in the phase*. Do it at
step 3, on the debug rectangle, before any of the interesting code exists. A desync found
then is a design fix; found at step 8 it is a rewrite.

Playwright is still not installed (the deploy workflow runs typecheck, Vitest, build, and
artifact checks only). Stylus input is not something Playwright simulates convincingly, so
this phase is not the reason to add it.

---

## 14. Decisions wanted before step 4

1. **`touch-action`: `pan-y` or `none`?** §4 recommends `pan-y` — finger scrolls, pen draws
   — superseding plan §7 and matching what `app.css` already ships. It changes the input
   pipeline, so settle it before writing one.
2. **Finger drawing when no pen has ever been seen.** A user on a phone, or a trackpad, has
   no stylus. Allow finger-draw until the first pen event arrives and then disable it
   permanently (the plan's rule read literally), or require a pen always? The first is more
   forgiving and slightly surprising the moment a pen appears.
3. **Stroke simplification on commit.** `perfect-freehand` has `streamline`, and raw points
   could additionally be simplified (Ramer–Douglas–Peucker) before storage. Smaller records
   and faster redraws, at the cost of fidelity on tight, small handwriting — which is
   precisely what people annotating code produce. Default to *no* simplification and revisit
   with real data?

None of these block steps 1–3, so the phase can start regardless.

---

## 15. Deliberately not in this phase

Layer UI (Phase 4), typed notes (Phase 4), bookmarks (Phase 4), Code Space (Phase 5),
persisted undo across reloads, symbol extraction for anchors, the anchor-resolution Web
Worker, and handwriting OCR (Phase 6, and genuinely optional).

**Done when:** you can annotate a file on a tablet with a stylus, scroll fast, and the ink
stays welded to the code — then reload and find it exactly where you left it.

---

*Read code. Annotate it. That's it.*
