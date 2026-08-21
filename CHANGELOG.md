# Change Log

## 0.2.4

- Ghost rendering artifacts fixed by anchoring the ghost to a real character instead of an empty range (where VS Code chooses the association on its own and glued the real padding space into the block: an unselectable dot fused left of the ghost, an unpainted gap before the `|`, and a dot interrupting the separator's dash line). The visual order is now canonical by construction: `text + ghost + real space + |` (mirrored for right-aligned columns; continuous dashes in the separator with the dot in its own slot at the end).

## 0.2.3

- Ghost alignment fixed, two bugs: (1) the ghost padding used regular spaces, which the editor collapses inside decoration `contentText` — compact tables barely got ~1 character of ghost (dashes in the separator row never collapsed, which is why it did align); now real ` `. (2) The ghost is now truly differential: it discounts the real padding a cell already carries (beyond the canonical single space around `|`), so already-expanded cells get no ghost at all and half-expanded ones only get the difference. The core's `splitRowDetailed` now exposes `segStart`/`segEnd` per cell for this.

## 0.2.2

- Tab vs Markdown Table, solved for real: when both extensions bind Tab, VS Code runs the last-loaded one (Markdown Table), so the compact-mode takeover never fired. The fix is two user-level keybinding rules (user rules beat extensions) carrying the `tabOurs` clause — they only fire when this extension owns the Tab. The extension now detects the conflict once and offers to copy the snippet; it is also documented in the README.

## 0.2.1

- Namespace rename, clean break while unpublished: settings, commands and context keys move from `markdownTables.*` to `markdownGhostTables.*` (the extension's own identity — the old prefix was generic enough to collide with other table extensions). Command palette titles now read "Markdown Ghost Tables: …" too. Update any `.vscode/settings.json` accordingly; no migration shim is provided.

## 0.2.0

- Status bar menu: a status bar item (markdown files only, shows the current mode) opens a checklist to toggle ghost alignment, column colors, expand mode, Tab navigation and format-on-save in place.
- Settings redesign: new `markdownTables.mode` (`compact`/`expand`) drives both format-on-save and Tab formatting; `markdownTables.formatOnSave` is now a boolean; `markdownTables.tabFormatMode` was removed.
- Tab coexistence with Markdown Table reworked: its Tab wins only in `expand` mode; in `compact` mode this extension takes the Tab (previously it always yielded).

## 0.1.0

- Initial release: ghost (virtual) column alignment with tinted padding, per-column rainbow colors, compact/expand commands, format-on-save resting state, optional Tab/Shift+Tab cell navigation (yields to the Markdown Table extension when installed).
