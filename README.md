# Markdown Ghost Tables

Keep your markdown tables **compact in the file** while they **look perfectly aligned on screen**.

Alignment padding in markdown tables is presentation, not content: it bloats files, makes diffs rewrite whole rows when one cell grows, and costs tokens for AI agents that read your repos. This extension decouples bytes from pixels.

## Features

- **Ghost alignment** — virtual padding rendered with VS Code decorations: compact tables look column-aligned without a single real space written to the file. The ghost padding has a subtle background tint so you always know which spaces are real. Adaptive by design: on a table that is already aligned with real spaces it renders nothing, so it never double-aligns.
- **Column colors** — each column gets a subtle rainbow-style background for readability.
- **Compact / Expand commands** — normalize all tables in the document either way, preserving alignment colons (`:---`, `---:`, `:---:`), escaped pipes (`\|`) and tables inside code fences (untouched).
- **Format on save** — declare the mode (`compact` or `expand`) per user or per repo (`.vscode/settings.json`), enable format-on-save, and every save normalizes the tables.
- **Status bar menu** — a `$(table)`-style status bar item (visible on markdown files, showing the current mode) opens a checklist to toggle every feature in place: ghost alignment, column colors, expand mode, Tab navigation and format-on-save. Handy for isolating what you see while debugging a table.
- **Tab navigation (optional, off by default)** — Tab/Shift+Tab inside a table formats it to the mode and jumps between cells, adding a new row at the end. Coexistence with the [Markdown Table](https://marketplace.visualstudio.com/items?itemName=TakumiI.markdowntable) extension: in `expand` mode its Tab wins (it is the full table *editor*, aligning with real spaces); in `compact` mode this extension takes the Tab — this one governs how tables rest and how they look.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `markdownGhostTables.mode` | `compact` | Table mode (`compact` / `expand`): drives format-on-save and Tab formatting |
| `markdownGhostTables.ghostAlign` | `true` | Virtual column alignment |
| `markdownGhostTables.ghostTint` | `rgba(128,128,128,0.10)` | Background tint of ghost padding |
| `markdownGhostTables.columnColors` | `true` | Rainbow column backgrounds |
| `markdownGhostTables.formatOnSave` | `false` | Normalize all tables to the mode on save |
| `markdownGhostTables.tabNavigation` | `false` | Tab formats to the mode + jumps between cells |

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

## License

[MIT](LICENSE.md)

## Credits

The icon for this extension is based on the Flaticon library: [Table icons created by Magnific - Flaticon](https://www.flaticon.com/free-icons/table)
