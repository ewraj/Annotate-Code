# AnnotateCode

## One sentence

AnnotateCode is a web-based code reader that lets you read, write on, and study source code like a PDF.

> Read code. Annotate it. That's it.

---

# Product Philosophy

AnnotateCode should feel like a simple utility, not a startup platform.

The core experience is:

OPEN CODE → READ → ANNOTATE → SAVE → COME BACK LATER

Do not turn it into an IDE.

Do not add features simply because other developer tools have them.

The product should remain intentionally limited and extremely good at its one purpose:

> Reading and understanding code.

Think:

**PDF reader + pen + codebase**

rather than:

**VS Code + annotations**

---

# What AnnotateCode IS

- A code reading environment
- A document-like view of a codebase
- A place to annotate source code
- A lightweight code editor
- A study/review tool for unfamiliar codebases
- A persistent place to keep understanding of code

# What AnnotateCode IS NOT

- An IDE
- A compiler
- A debugger
- A terminal
- A Git client
- A project-management tool
- An AI coding assistant
- An AI code explainer
- An Obsidian-style knowledge graph
- A social network

There should be no "Run" button.

---

# Homepage

Keep the homepage extremely simple.

Header:

AnnotateCode

Right side:

GitHub
About

Main:

Read code. Annotate it. That's it.

A short explanation:

A simple way to read, write on, and understand code.

Primary action:

Open a codebase

Secondary action:

Paste a GitHub URL

Small line:

Free and open source.

Below this, show a small code preview demonstrating the actual product.

The preview should show source code with a handwritten annotation attached to a function.

For example:

```text
export async function runJob(job) {
    const runtime = await getRuntime(job);
    await runtime.prepare();
    const result = await runtime.run();
    return result;
}
```

with a handwritten-style annotation:

"this is where the job actually runs"

The homepage should communicate the product visually without needing a long explanation.

---

# Design

The UI should be:

- Minimal
- Quiet
- White/off-white
- Dark text
- Neutral gray secondary text
- Thin borders
- Small rounded corners
- Lots of whitespace
- Clean typography
- Very little color

Avoid:

- Gradients
- Excessive animations
- Giant illustrations
- SaaS-style feature grids
- Marketing language
- Excessive cards
- Dashboard aesthetics

The code/document should be the visual centerpiece.

The product should feel like a tool someone might bookmark and use for years.

---

# Core Application

After opening a codebase, the application should primarily consist of:

LEFT:
File tree

CENTER:
Code/document

TOP:
Minimal toolbar

The code should occupy most of the screen.

Do not surround the code with unnecessary UI.

---

# Opening Code

Support:

1. Local codebase upload
2. Public GitHub repository URL
3. Individual source files
4. Creating a new file

GitHub should NOT require OAuth.

A user should be able to paste:

https://github.com/user/repository

and get the repository opened as a codebase.

GitHub is a source of code, not a Git management feature.

No:

- commits
- branches
- pull requests
- Git UI

---

# Code Viewer

Every file should be rendered with:

- Syntax highlighting
- Line numbers
- Proper indentation
- Horizontal scrolling where necessary
- Normal text selection
- Smooth vertical scrolling

The code should feel like a document.

The most important technical requirement:

## Code and annotations must behave as ONE document.

If the user scrolls:

code + ink + notes

must move together perfectly.

Avoid a janky experience where the code is scrolling independently from a canvas.

---

# Editing

The user can edit source code.

The user can:

- Modify existing files
- Create new files
- Delete files
- Rename files

Creating a file should be simple:

```text
filename.ts
```

and then the editor opens it.

However:

Editing does NOT mean execution.

The user should still have no terminal/compiler/run functionality inside AnnotateCode.

---

# Annotation Tools

Core tools:

- Pen
- Highlighter
- Eraser
- Undo
- Redo

Optional controls:

- Pen thickness
- Highlighter thickness
- Basic colors

The pen should feel natural.

Prioritize:

- Pointer events
- Stylus support
- Pressure where available
- Stroke smoothing
- Palm rejection where possible
- Low perceived latency

The goal is:

> writing on code should feel like writing on a PDF or image with an iPad Pencil.

Not:

> drawing on a webpage canvas.

---

# Annotation Anchoring

Annotations must be attached to the document.

Do NOT treat annotations as simply:

```text
x: 421
y: 823
```

relative to the browser viewport.

They should be anchored to code/document positions.

Ideally an annotation contains something conceptually similar to:

```text
file
code range
content/symbol anchor
annotation geometry
annotation data
```

so that annotations remain associated with the correct code even when the viewport changes.

Raw line numbers alone are not enough because code can change.

Use graceful fallback when code changes.

---

# Code Space

A future/important feature.

Code Space adds deliberate annotation space between lines of code.

Normal:

```text
41  const runtime = getRuntime(job);
42  await runtime.prepare();
43  const result = await runtime.run();
```

Code Space:

```text
41  const runtime = getRuntime(job);

    [ annotation space ]

42  await runtime.prepare();

    [ annotation space ]

43  const result = await runtime.run();

    [ annotation space ]
```

The purpose is to stop relying entirely on empty space to the right of the code.

Code Space turns the vertical document into an annotation canvas.

The user should be able to write between pieces of code.

Important:

Code Space will require careful coordination between:

- Code layout
- Text
- Ink
- Typed annotations
- Scrolling
- Editing
- Resizing
- Line changes

Do not over-engineer this initially.

Build the basic annotation system first.

---

# Annotation Layers

Annotations should support independent layers.

Example:

```text
Layers

☑ My Notes
☐ Questions
☑ Architecture
```

Each layer can be:

- Created
- Renamed
- Shown
- Hidden
- Deleted

Annotations belong to a layer.

The same code can therefore have different annotation contexts.

Example:

```text
My Notes
Questions
Exam Revision
Architecture
```

Layers should not become a complicated design system.

They are simply independent annotation sets.

---

# Bookmarks

Users can bookmark locations in the codebase.

Bookmarks should behave similarly to PDF bookmarks.

A bookmark can optionally have:

- Name
- Color
- File
- Code location

Example:

```text
Bookmarks

Runner entry point
WebContainer setup
Python execution
Important TODO
```

Clicking a bookmark should immediately take the user to that location.

---

# Annotation Index

Provide a place where users can search their own annotations.

For example:

```text
Search annotations...

webcontainer
```

Results:

```text
runner.ts
Line 182

"My notes about how WebContainer is initialized..."
```

Clicking the result jumps directly to the annotation.

Potentially support OCR for handwritten annotations.

OCR does NOT need to be perfect in the first version.

The important idea is:

> My annotations become searchable.

---

# Reading Position

Remember where the user stopped reading.

When they reopen a codebase/file, restore them to approximately the same location.

The user should feel:

> "I came back to exactly where I left off."

This is especially important for large repositories.

---

# Persistence

The application should persist:

- Source/codebase metadata
- Files
- Edits
- Annotations
- Annotation layers
- Bookmarks
- Reading position
- Open file
- Potentially UI state

Initially, local persistence is acceptable.

The architecture should leave room for cloud persistence later.

---

# Accounts / Sync

Eventually users should be able to sign in so their work can follow them between devices.

Example:

PC:

```text
Read repository
Annotate heavily
Close
```

iPad:

```text
Open AnnotateCode
Same repository
Same annotations
Same reading position
```

Accounts should exist for persistence/sync/sharing, NOT because users need an account just to try the product.

Anonymous usage should remain as frictionless as possible.

---

# Sharing

Eventually allow users to share:

- Code
- A specific annotation layer
- Bookmarks
- Reading context

The recipient should be able to view the shared material without modifying the original owner's source/annotations.

Think:

> "Here's the code. Here's how I annotated it."

Not:

> collaborative IDE.

---

# Version-Aware Annotations

One important long-term problem:

What happens if the source code changes?

Annotations should ideally use more than line numbers.

Possible anchor information:

```text
file:
symbol:
start/end range:
content hash:
nearby source context:
```

When reopening:

1. Try exact anchor.
2. Try content/symbol match.
3. Try nearby context.
4. If unresolved, show the annotation as displaced/unresolved rather than silently putting it somewhere wrong.

Never silently move someone's handwritten notes to the wrong code.

---

# Supported Languages

Start with common languages.

Syntax highlighting should support as many common source formats as practical.

Do not build language-specific execution systems.

AnnotateCode does not care whether the code is:

```text
TypeScript
JavaScript
Python
C++
Rust
Java
Swift
Go
...
```

It only needs to display and annotate it.

---

# Mobile / Tablet

Tablet support is important.

A compelling use case:

Someone receives a large GitHub repository.

They open it on an iPad.

They read through the code.

They use a stylus to annotate it.

They return later on a PC.

The experience should therefore be designed around:

- Touch
- Stylus
- Scrolling
- Responsive code layout
- Large enough annotation targets
- Minimal UI

Do not make desktop the only first-class experience.

---

# Performance

Performance matters more than feature count.

A large codebase should remain usable.

Prioritize:

- Smooth scrolling
- Efficient rendering
- Efficient annotation rendering
- Lazy loading where appropriate
- Avoiding thousands of unnecessary DOM/canvas operations
- Keeping ink responsive
- Not blocking the main thread unnecessarily

The user should never feel:

> "The code is lagging because I drew on it."

---

# Architecture Principle

Treat the codebase as a DOCUMENT.

Conceptually:

```text
CODEBASE
  └── FILE
       ├── SOURCE
       ├── ANNOTATIONS
       ├── BOOKMARKS
       └── READING POSITION
```

Not:

```text
IDE
 ├── compiler
 ├── terminal
 ├── debugger
 ├── git
 ├── extensions
 └── annotations
```

The document is the primary object.

---

# Minimal MVP

The first usable version does NOT need everything above.

MVP:

- Open local codebase
- File tree
- Syntax highlighting
- Line numbers
- Read code
- Edit code
- Create files
- Pen
- Highlighter
- Eraser
- Undo/redo
- Persistent local annotations
- Annotation anchoring
- Smooth scrolling

That's enough.

Then add:

- Layers
- Bookmarks
- GitHub URL opening
- Annotation search
- Code Space
- Sharing
- Accounts
- Cloud sync
- Handwriting OCR

in whatever order makes sense after actually using the product.

---

# Extremely Important

Do not build features just to make the product look bigger.

AnnotateCode wins by being:

**simple**
**fast**
**pleasant**
**obvious**

The product should make someone immediately understand:

> "Oh, this is where I go when I need to READ a codebase."

---

# Business / Project Philosophy

AnnotateCode is intended to remain:

- Free
- Open source
- No advertisements
- No premium tier
- No subscription
- No artificial feature restrictions

Optional support:

> Buy me a chai ☕

should be unobtrusive.

The purpose is to build a useful piece of software that people remember and bookmark.

Success is not necessarily measured by revenue.

If thousands of developers know:

> "AnnotateCode — that website where I can actually sit down and annotate a codebase."

that's a successful outcome.

---

# Final Product Test

Before adding a feature, ask:

> Does this make reading and understanding code better?

If yes:

Consider it.

If no:

Don't add it.

The product should always come back to:

# Read code. Annotate it. That's it.
