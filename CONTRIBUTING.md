# Contributing to AnnotateCode

Thanks for being here. This is a small, deliberately narrow project, and the most useful
thing you can read before opening a pull request is what it refuses to become.

## The one test

Every change is measured against a single question, taken from the product gist:

> Does this make reading and understanding code better?

If the answer is no, the change does not belong here — however well written it is.

## Read these first

- [`ANNOTATECODE_PRODUCT_GIST.md`](ANNOTATECODE_PRODUCT_GIST.md) — what the product is and
  what it refuses to be.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — how it gets built, in what order, and
  which decisions are expensive to reverse. §13 is a list of things deliberately deferred,
  each with a reason.

## Things that will be declined

Not because they are bad ideas, but because they are not this product:

- Anything that moves it toward being an IDE — IntelliSense, a debugger, a "Run" button,
  language servers, refactoring tools.
- Git features. Commits, branches, diffs, blame. The product reads code; it does not manage
  it.
- Features added because other developer tools have them.
- Anything that surrounds the code with more UI. The code is the centrepiece.

If you are unsure whether an idea fits, open an issue before writing the code. It is a much
cheaper conversation than a closed pull request.

## Ground rules that are not negotiable

These come from the gist and drive most of the architecture:

1. **Code and ink behave as one document.** There is exactly one scrolling element. Nothing
   in the annotation layer may depend on viewport pixels, window size, or scroll offset.
2. **Tablet and stylus are first-class.** Not an afterthought, and not desktop-only.
3. **Annotations anchor to code, not to pixels or bare line numbers.**
4. **A handwritten note is never silently moved to the wrong code.** `unresolved` is a real,
   expected outcome, not a failure to paper over.
5. **Performance over feature count.**

## Getting set up

```bash
npm ci
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # typecheck + production build
```

## Before you open a pull request

```bash
npm run typecheck && npm test && npm run build
```

CI runs exactly these, so running them locally is the fastest way to find out.

### Tests

New behaviour needs a test where the behaviour is testable without a browser. The dense
suites live in `src/model/anchor.test.ts` (anchor resolution) and `src/ink/` (stroke
geometry, undo history, reflow across edits) — match the style there: table-driven, one
assertion per claim, and a name that states the claim rather than the mechanism.

Anything touching anchoring deserves more tests than you think. Getting it wrong misplaces
somebody's handwriting.

### Things CI cannot check

Stylus feel and ink/scroll behaviour have no substitute for a real device. If your change
touches the ink engine, say in the pull request what you tested it on.

## Commits and pull requests

- Write commit messages that explain **why**, not what — the diff already says what. Look at
  the existing history for the register.
- Keep one concern per pull request. Two unrelated fixes are two pull requests.
- `main` requires a pull request, a passing `verify` check, and a review. Merges are squash
  or rebase; the history stays linear.
- Mark it as a draft while it is still moving.

## Reporting bugs

Include the browser and OS, whether you were using a mouse, a finger, or a stylus, and what
you expected instead. For anything involving ink or anchoring, the file and roughly where on
it you were drawing helps a great deal.

## Security

Please do not open a public issue for a security problem. See [`SECURITY.md`](SECURITY.md).

## Licence

By contributing, you agree that your contributions are licensed under the
[MIT Licence](LICENSE) that covers this project.
