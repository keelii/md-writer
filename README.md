# MDWriter

`MDWriter` is a lightweight Markdown editor built with ProseMirror. It exposes a
single global `MDWriter.init()` API and keeps the editor content available via
`getMarkdown()` / `onChange` callbacks.

## Features

- WYSIWYG editing for Markdown content with automatic serialization and parsing
- Headings, lists (nested), blockquotes, inline code, links, and tables with
  per-column alignment and row/column operations
- Inline HTML marks: `<u>`, `<mark>`, `<sub>`, `<sup>`, `<kbd>`, `<abbr>`
- Syntax-highlighted code blocks (highlight.js, per-block language switcher and
  copy button)
- Raw-block preservation for math (`$$`), iframes, YAML frontmatter, footnotes,
  Mermaid diagrams, standalone SVG, and general HTML blocks
- Built-in table of contents panel and vertical rhythm grid
- Optional localStorage persistence (content + UI state)
- Optional toolbar binding via `data-md-editor-command`
- Mermaid and math preview hooks for richer article editing
- Image upload hook via `onImageUpload`
- Built-in DOM construction uses a tiny JSX factory (`src/jsx.ts`), so widget
  and toolbar code is written as JSX instead of imperative `createElement` calls

## Quick start

Install dependencies from the repo root:

```bash
npm install
```

Start the local development bundle:

```bash
npm run dev
```

This watches `src/index.tsx` and writes the bundle to:

- `dist/index.js` (with `dist/index.js.map`)
- `dist/index.css` (with `dist/index.css.map`) — component styles imported from TS sources

The demo page in the repo root (`index.html`) loads that bundle.

## Minimal usage

```html
<div class="content-editor"></div>

<script src="./dist/index.js"></script>
<script>
  window.MDWriter.init({
    mount: ".content-editor",
    initialMarkdown: "# Hello\n\nWrite something here.",
    placeholder: "开始输入 Markdown…",
    onChange: (markdown) => {
      console.log(markdown);
    }
  });
</script>
```

## Options

`MDWriter.init(options)` accepts:

- `mount` (required): editor mount element or selector.
- `initialMarkdown` (optional): initial Markdown content.
- `placeholder` (optional): placeholder text when the document is empty.
- `onChange(markdown)` (optional): called whenever the document changes.
- `viewBarRoot` (optional): root element for auto-rendered view controls.
- `formatBarRoot` (optional): root element for auto-rendered toolbar buttons.
- `tocRoot` (optional): mount element for the table of contents panel.
- `tocMaxDepth` (optional, default `3`): maximum heading depth included in the TOC.
- `defaultShowTOC` (optional, default `false`): show the TOC panel on init.
- `defaultShowRhythmGrid` (optional, default `false`): show the vertical rhythm grid on init.
- `rawPreview` (optional, default `false`): render math and iframe blocks as read-only previews in WYSIWYG mode.
- `mermaidAssets` (optional): custom Mermaid asset URLs or paths.
- `katexAssets` (optional): custom KaTeX asset URLs or paths.
- `onImageUpload(file)` (optional): async hook for image uploads; return a URL or `{ src, alt, title }`.
- `storage` (optional, `"localStorage"`): persist document content and UI
  state; saved content (`md-writer:content`) is restored in priority over
  `initialMarkdown`, and saved state (`md-writer:state`) over the `default*`
  options.

The editor instance returned by `init()` also exposes `getMarkdown()`,
`setMarkdown(markdown)`, `focus()`, `refreshMermaidPreviews()`, and `destroy()`.

## Toolbar bindings

Any element with `data-md-editor-command="..."` is bound automatically to a
matching command. Built-in commands include:

- `bold`
- `italic`
- `strike`
- `inline_code`
- `link`
- `image_upload`
- `blockquote`
- `bullet_list`
- `ordered_list`
- `table_insert`
- `undo`
- `redo`

Table context commands (only visible/enabled inside a table):

- `table_add_row`
- `table_add_column`
- `table_delete_row`
- `table_delete_column`
- `table_move_row_up`
- `table_move_row_down`
- `table_move_column_left`
- `table_move_column_right`

## View controls

Any element with `data-md-editor-view="..."` is bound automatically to a
view-level control. Built-in controls include:

- `toggle_source` (shortcut: `Meta+E`)
- `toggle_toc`
- `toggle_rhythm`
- `show_help`

Example:

```html
<button type="button" data-md-editor-command="bold">Bold</button>
<button type="button" data-md-editor-command="italic">Italic</button>
<button type="button" data-md-editor-command="link">Link</button>
```

## Supported Markdown patterns

The editor recognizes common formatting shortcuts:

- `# ` / `## ` / `### ` ... → headings
- `* ` or `- ` → bullet list
- `1. ` → ordered list
- `> ` → blockquote
- `---` on its own line → horizontal rule
- `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)` → inline marks
- `<u>` / `<mark>` / `<sub>` / `<sup>` / `<kbd>` / `<abbr title="...">` → inline HTML marks
- `$...$` → inline math, `$$ ... $$` → display math raw block
- ``` ```lang ``` → fenced code blocks (syntax highlighting for js/ts/python/
  java/c/php/go/css/xml/markdown/bash; other languages stay plain text)
- ``` ```mermaid ``` → Mermaid diagram with fullscreen pan/zoom preview
- Tables with GFM alignment separators (`:---`, `:---:`, `---:`) and `<br>` line breaks in cells
- `--- ... ---` (at document start) → YAML frontmatter raw block
- `[^id]: ...` → footnote definition raw block (continuation lines indented by 4 spaces or a tab)
- `[^id]` → footnote reference (inline)
- `<iframe ...></iframe>` → iframe raw block
- HTML blocks starting with `div`, `section`, `figure`, `details`, `svg`, etc. → HTML raw blocks
- Standalone `<svg ...>` → rendered SVG preview block

When `rawPreview` is enabled:

- display math and iframe blocks are shown as read-only previews in WYSIWYG mode
- footnote raw blocks remain editable in WYSIWYG mode
- source editing is still the best option for writing complex raw Markdown blocks

## Build

Bundling is done with esbuild (see the `dev` script in `package.json`):

```bash
./node_modules/.bin/esbuild src/index.tsx \
  --bundle \
  --format=iife \
  --target=es2018 \
  --global-name=MDWriter \
  --outdir=dist \
  --sourcemap \
  --jsx=transform \
  --jsx-factory=h \
  --jsx-fragment=Fragment
```

Output: `dist/index.js` (IIFE, exposes the `MDWriter` global) plus a sourcemap.
Component styles live next to their TS/TSX modules as `*.css` files (e.g.
`src/prosemirror/heading-menu.css`) and are pulled in via plain
`import "./xxx.css"`; esbuild collects them into `dist/index.css`, which the
demo page loads via a `<link>` tag.

Drop `--watch` / add flags as needed:

```bash
# watch mode (same as npm run dev)
./node_modules/.bin/esbuild src/index.tsx --bundle --format=iife --target=es2018 \
  --global-name=MDWriter --outdir=dist --sourcemap --watch \
  --jsx=transform --jsx-factory=h --jsx-fragment=Fragment
```

## JSX factory

Files that use JSX are named `*.tsx`. esbuild transforms the syntax with:

- `--jsx-factory=h`
- `--jsx-fragment=Fragment`

Both come from `src/jsx.ts`, a small hand-written runtime:

- `h(tag, attrs, ...children)` creates real DOM nodes (no virtual DOM)
- supported attributes: `className`/`class`, `style` (string or object),
  `innerHTML`, and `on*` event handlers (values must be functions)
- boolean / `null` / `undefined` / `false` attributes are skipped
- `Fragment` appends children without a wrapper element

Because JSX here compiles to real `HTMLElement`s, no extra rendering layer is
needed.

## Type checking

The project has no `tsconfig`-driven build; type checks are run directly with
`tsc`:

```bash
npx --yes -p typescript tsc \
  --ignoreConfig \
  --noEmit \
  --strict \
  --target es2018 \
  --module esnext \
  --moduleResolution bundler \
  --skipLibCheck \
  --jsx react \
  --jsxFactory h \
  --jsxFragmentFactory Fragment \
  src/index.tsx
```

Pass any additional files as arguments (e.g. `src/prosemirror/*.tsx`).
`src/globals.d.ts` declares `*.css` modules so CSS imports type-check cleanly.

## Tests

Verification scripts live in `test/verify-*.ts` (run with `tsx`). Sources
import CSS files, so tests need the CSS shim that treats `*.css` imports as
empty modules:

```bash
npx --yes tsx --import ./test/css-shim.mjs test/verify-code-tab.ts
npx --yes tsx --import ./test/css-shim.mjs test/verify-toc.ts
# ... or run all of them:
for f in test/verify-*.ts test/verify-*.mjs; do npx --yes tsx --import ./test/css-shim.mjs "$f"; done
```

There are also two `.mjs` sanity checks (they import TS sources, so run them with `tsx` too):

```bash
npx --yes tsx --import ./test/css-shim.mjs test/verify-schema.mjs
npx --yes tsx --import ./test/css-shim.mjs test/verify-table-br.mjs
```