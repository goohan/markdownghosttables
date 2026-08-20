# Markdown Ghost Tables

Keep your markdown tables **compact in the file** while they **look perfectly aligned on screen**.

Alignment padding in markdown tables is presentation, not content: it bloats files, makes diffs rewrite whole rows when one cell grows, and costs tokens for AI agents that read your repos. This extension decouples bytes from pixels.

## Features

- **Ghost alignment** — virtual padding rendered with VS Code decorations: compact tables look column-aligned without a single real space written to the file. The ghost padding has a subtle background tint so you always know which spaces are real. Adaptive by design: on a table that is already aligned with real spaces it renders nothing, so it never double-aligns.
- **Column colors** — each column gets a subtle rainbow-style background for readability.
- **Compact / Expand commands** — normalize all tables in the document either way, preserving alignment colons (`:---`, `---:`, `:---:`), escaped pipes (`\|`) and tables inside code fences (untouched).
- **Format on save** — declare a resting state (`compact` or `expand`) per user or per repo (`.vscode/settings.json`) and every save normalizes the tables.
- **Tab navigation (optional, off by default)** — Tab/Shift+Tab inside a table formats it and jumps between cells, adding a new row at the end. It automatically yields if the [Markdown Table](https://marketplace.visualstudio.com/items?itemName=TakumiI.markdowntable) extension is installed — that extension remains the full table *editor*; this one governs how tables rest and how they look.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `markdownTables.ghostAlign` | `true` | Virtual column alignment |
| `markdownTables.ghostTint` | `rgba(128,128,128,0.10)` | Background tint of ghost padding |
| `markdownTables.columnColors` | `true` | Rainbow column backgrounds |
| `markdownTables.formatOnSave` | `off` | `compact` / `expand` resting state applied on save |
| `markdownTables.tabNavigation` | `false` | Tab formats + jumps between cells |
| `markdownTables.tabFormatMode` | `expand` | Format used while Tab-navigating |

## Known limitations

- Column widths are measured in code points: emoji and CJK double-width characters are approximated.
- Center alignment pads to the right (like left alignment) in this version.

## Development

```sh
npm install
npm run build     # bundles src/ into dist/extension.js
npm run package   # produces the .vsix
```

The formatting algorithm lives in [src/core.mjs](src/core.mjs), dependency-free and VS Code-free; the extension ([src/extension.mjs](src/extension.mjs)) only maps its table model to editor decorations.
