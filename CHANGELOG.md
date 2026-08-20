# Change Log

## 0.2.1

- Namespace rename, clean break while unpublished: settings, commands and context keys move from `markdownTables.*` to `markdownGhostTables.*` (the extension's own identity — the old prefix was generic enough to collide with other table extensions). Command palette titles now read "Markdown Ghost Tables: …" too. Update any `.vscode/settings.json` accordingly; no migration shim is provided.

## 0.2.0

- Status bar menu: a status bar item (markdown files only, shows the current mode) opens a checklist to toggle ghost alignment, column colors, expand mode, Tab navigation and format-on-save in place.
- Settings redesign: new `markdownTables.mode` (`compact`/`expand`) drives both format-on-save and Tab formatting; `markdownTables.formatOnSave` is now a boolean; `markdownTables.tabFormatMode` was removed.
- Tab coexistence with Markdown Table reworked: its Tab wins only in `expand` mode; in `compact` mode this extension takes the Tab (previously it always yielded).

## 0.1.0

- Initial release: ghost (virtual) column alignment with tinted padding, per-column rainbow colors, compact/expand commands, format-on-save resting state, optional Tab/Shift+Tab cell navigation (yields to the Markdown Table extension when installed).
