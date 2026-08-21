# Change Log

## 0.2.21

- Pipe ownership rule: every pipe is painted exactly once, by the column to its left, consistent in every row. Next to a right-aligned column both cells used to back the shared pipe — stacked colors that matched neither column and changed per row (spotted by Johan's red circles). The left cell's backing now extends one char further to also cover the right-aligned neighbor's pill; residual compromise: that pill sits on the left column's base color (subtle at real alphas).

## 0.2.20

- Rounded pill corners in color mode too: safe now that the backing ranges exist — the corner notches reveal the band behind, not naked editor background.

## 0.2.19

- The pill's background is finally REAL: the editor paints range backgrounds as full-line rectangles that cover widgets between the range's characters (the separator's ghost always enjoyed this) but never widgets at range edges — so each data ghost now gets a backing range crossing its gap (last segment char + closing pipe, mirrored for right-aligned columns), with the rest of the cell as an adjacent range of the same color. Accepted price: the crossed pipe tints with the column color. This replaces the glyph-height own-box hack (0.2.18), which the Ctrl+scroll zoom broke; one dial for all rows now — ghostShade 0 = fully uniform cell, higher = pill.

## 0.2.18

- The naked slivers above/below the data pills are gone (diagnosed with the shade dials cranked and Johan's red marks): attachment boxes are glyph-high, not line-high, so their background left the line's extra height unpainted — the band never shows this because the editor paints range backgrounds as full-line rectangles, which is also why the band-backed separator pill had no slivers. Data pills now get an explicit line-height-sized box (from editor.lineHeight / 1.35 × fontSize, recomputed when those settings change).

## 0.2.17

- New `bandShade` setting: live multiplier over each column's alpha for the band background, sibling of `ghostShade` (whose range grows to 0–20 as well). Cranking both high makes the paint anatomy unmistakable — the diagnosis dial for the remaining unpainted-region issue.

## 0.2.16

- The separator's ghost also answers to `ghostShade` (it was transparent under the band, so the dial didn't reach it): the whole table now tunes with one number. Johan's ideal mock shows the pill in every row, separator included.

## 0.2.15

- New `ghostShade` setting: live multiplier over the column's alpha for the ghost background (default 0.7). Attachment and range backgrounds don't composite identically at equal rgba (1.0 rendered darker than the band, 0.5 lighter), so the uniform point is calibrated by eye — and above it the same dial makes the ghost stand out as a subtle pill.

## 0.2.14

- Bare pipes are back (the pipe-tinted contiguous bands of 0.2.13 didn't convince) and the right-aligned ghost returns to its left-pipe anchor, whose typing behavior was right. The uniform look survives both reverts because the real fix was elsewhere: attachment backgrounds render about twice as strong as range backgrounds at the same rgba, so the edge-glued data ghosts now self-paint the column hue at HALF alpha (empirically calibrated); the separator's interior ghost stays transparent under the band.

## 0.2.13

- Uniform cell paint, for real this time: a range background covers its full visual span including widgets injected BETWEEN its characters, but not widgets hanging at its edges — which is why the separator (interior ghost) painted uniform while data cells (pipe-glued ghost) left an unpainted island. The band now includes the closing pipe, turning the pipe-glued ghost into an interior widget (pipes tint with their left column; bands read contiguous), and right-aligned cells anchor their ghost interior on the left (after the leading space — typing at the end of a right-aligned text never meets the ghost).

## 0.2.12

- Truly flat cells: with column colors on, the ghost paints no background of its own. The band's background rectangle already covers the range's full visual span — injected ghost widgets included — so the ghost's own paint stacked a second layer of the same shade and the blocks still read darker (a saw following text lengths, even with equal alphas in 0.2.11). Gray mode (colors off) keeps the ghost tint and rounded corners.

## 0.2.11

- Uniform cell color: the ghost blocks now take exactly the band's shade (same hue, same alpha), so the whole cell paints flat wall to wall. The stronger ghost alpha of 0.2.9 made the soft band read as unpainted and the blocks as stairs following the text lengths (spotted by Johan). Real vs virtual is told by the whitespace dots; gray mode (colors off) keeps the tint contrast and the rounded corners.

## 0.2.10

- Color band polish: the ghost's rounded corners now apply only in gray mode (colors off) — with the bands on they notched dark editor background around each block, reading as an ugly margin; flush blocks make the whole cell read colored wall to wall. Palette saturation raised a notch, mainly to pull the first two hues (blue and teal) apart.

## 0.2.9

- Column colors paint continuous bands (chosen by Johan over color-means-real and text-only): the whole cell segment — text, real padding and the separator row — in the column's soft shade, with ghost padding in the same hue at a stronger alpha. Before, the color hugged only the cell text, so compact tables showed a tiny colored box plus a big neutral slab per cell and the rainbow barely read. `ghostTint` remains the ghost background when column colors are off.

## 0.2.8

- Rounded ends on the ghost background (pure paint, zero geometry): when a left-aligned cell sits next to a right-aligned one, both ghosts anchor to the same pipe and read as one solid slab — the rounded corners make them read as two blocks with the pipe in the notch.

## 0.2.7

- Natural typing at the end of a cell: the ghost now glues to the cell's far pipe (mirrored for right-aligned columns), so all real content — text plus its reglamentary space — stays contiguous and the caret sits right after the text. Before, the ghost lived between text and space and the cursor could only land after the block. Separator rows keep their previous anchoring (continuous dash line).

## 0.2.6

- Compact formatting of EMPTY cells follows the linted convention: `| |` (one shared space), not the accidental `|  |` the joiner produced. Applies to the commands, format-on-save and Tab navigation alike (core change).

## 0.2.5

- Empty cells fixed (they overflowed the row: with empty text the splitter counts every real space as leading, so the differential saw zero padding and the ghost added the full column width on top). The differential is now measured on the whole segment — aligned, a segment spans width+2 columns; the ghost supplies only what the real characters don't — which is simpler, symmetric for right-aligned columns, and makes empty cells fall out naturally (anchored before their last real space: ghost, dot, pipe like every sibling row).

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
