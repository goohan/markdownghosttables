// Markdown Ghost Tables — the human surface of the table formatting core
// (src/core.mjs, baked into the bundle at build time: a single implementation
// for the extension and any external CLI consumers).

import * as vscode from 'vscode';
import { analyzeText, formatText, formatTable, measure } from './core.mjs';

// Per-column background palette (low alpha: works on light and dark themes).
// A column paints its WHOLE cells — text, real and ghost padding, separator
// row — in ONE flat shade: the band's background rectangle covers the range's
// full visual span, injected ghost widgets included, so with colors on the
// ghost paints NO background of its own (painting one stacked two layers of
// the same shade and the blocks read darker, as a saw following the text
// lengths). Real vs virtual is told by the whitespace dots.
const PALETTE = [
  { rgb: '70, 150, 235', alpha: 0.07 },
  { rgb: '55, 212, 155', alpha: 0.07 },
  { rgb: '228, 222, 140', alpha: 0.08 },
  { rgb: '208, 122, 208', alpha: 0.07 },
  { rgb: '230, 178, 100', alpha: 0.08 },
  { rgb: '125, 215, 255', alpha: 0.07 },
  { rgb: '160, 212, 138', alpha: 0.08 }
];
// The pipe-glued data ghosts sit outside the band's pixel span, so they paint
// their own background: the column hue with its alpha times the ghostShade
// setting — a live dial, because attachment and range backgrounds do not
// composite identically at equal rgba (empirical: 1.0 rendered darker than
// the band, 0.5 lighter). At the value where the cell looks uniform the dial
// doubles as the "pastille" control: above it, the ghost stands out.
const ghostBg = (c, shade) => {
  const p = PALETTE[c % PALETTE.length];
  return `rgba(${p.rgb}, ${p.alpha * shade})`;
};
const NBSP = '\u00A0'; // regular spaces collapse in contentText; nbsp guarantees width
const MT_ID = 'takumii.markdowntable'; // the Markdown Table extension (full table editor)
// rounded ends on the ghost background (via the textDecoration CSS escape
// hatch — pure paint, zero geometry): the pill reads as a pill. Safe in both
// modes since the backing ranges exist — with colors on the corner notches
// reveal the band behind, not naked editor background.
const GHOST_CSS = 'none; border-radius: 3px';

let ghostType;
let columnTypes = [];
let debounceTimer;
let statusItem;

const config = () => vscode.workspace.getConfiguration('markdownGhostTables');

const currentMode = () => (config().get('mode') === 'expand' ? 'expand' : 'compact');
const fullRange = (doc) => new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length);
const ghostColor = () => new vscode.ThemeColor('editorGhostText.foreground');

// ---------------------------------------------------------------- decorations

function updateDecorations(editor) {
  if (!editor || editor.document.languageId !== 'markdown') return;
  const cfg = config();
  const wantGhost = cfg.get('ghostAlign');
  const wantColors = cfg.get('columnColors');
  const tint = cfg.get('ghostTint');
  const shade = cfg.get('ghostShade') ?? 0.7;
  const pipeTint = cfg.get('pipeTint') !== false;
  const ghost = [];
  const buckets = columnTypes.map(() => []);

  if (wantGhost || wantColors) {
    for (const table of analyzeText(editor.document.getText())) {
      for (const row of table.rows) {
        row.cells.forEach((cell, c) => {
          const rightColumn = table.alignments[c] === 'right';
          const needed = (table.widths[c] ?? 3) + 2 - (cell.segEnd - cell.segStart);
          if (wantColors && cell.segEnd > cell.segStart) {
            // The editor paints range backgrounds as full-line rectangles
            // that cover widgets injected BETWEEN the range's characters —
            // never widgets hanging at its edges. So the pipe-glued ghosts
            // get a BACKING range that crosses their gap (last segment char
            // + closing pipe; mirrored for right-aligned cells), with the
            // rest of the cell as a second adjacent range of the same color.
            // Price accepted: the crossed pipe tints with the column color —
            // that is what buys a real, zoom-proof background behind the
            // pill (the alternative was the naked-sliver saga of 0.2.9-18).
            // Left cells end in ghosts glued to the pipe (Johan's block
            // model), so their pill needs the pipe inside the band as its
            // canvas — same for empty cells. Right-aligned pills sit interior
            // (between leading SP and text) and the separator's between its
            // dashes and trailing SP: those need no pipe, so pipeTint remains
            // cosmetic wherever no left pill exists.
            // pipeTint=true also serves as the pill's CANVAS: the band
            // rectangle spans through the pipe and paints behind the
            // pipe-glued pills. With pipeTint=false the pipes go truly bare
            // everywhere (Johan's call) and those pills self-paint with no
            // canvas behind — thin slivers may show above/below them,
            // especially under zoom: the accepted cost of that look.
            const bucket = buckets[c % columnTypes.length];
            bucket.push(new vscode.Range(row.line, cell.segStart, row.line, pipeTint ? cell.segEnd + 1 : cell.segEnd));
          }
          if (!wantGhost) return;
          // needed (computed above): truly differential, measured on the
          // whole segment — aligned, a cell's segment (between its `|`s)
          // spans width+2 columns (canonical single space on each side); the
          // ghost only supplies what the real characters — text and padding
          // alike — don't. Counting the segment instead of text+trailing
          // keeps it symmetric for right-aligned columns and makes empty
          // cells fall out naturally.
          const alignRight = rightColumn && !row.isSeparator;
          if (needed <= 0) return;
          // The ghost is anchored to a REAL character (before/after attachment
          // on a one-char range): on an empty range VS Code decides on its own
          // which character the widget associates with, and it glued the real
          // padding space into the block (unselectable dot fused left of the
          // ghost, unpainted gap before the `|`). Explicit anchors give the
          // canonical order: text + ghost + real space + `|` (mirrored when
          // right-aligned; dashes + ghost dashes + `:`/space in the separator).
          // Cells with no adjacent real padding fall back to an empty anchor.
          const push = (start, end, side, content) =>
            ghost.push({ range: new vscode.Range(row.line, start, row.line, end), renderOptions: { [side]: content } });
          if (row.isSeparator) {
            // every ghost is backed by the band now, so its own paint STACKS
            // over it — one dial for all rows: 0 = fully uniform cell,
            // higher = the pill stands out from the band's shade
            const content = { contentText: '-'.repeat(needed), color: ghostColor(), backgroundColor: wantColors ? ghostBg(c, shade) : tint, textDecoration: GHOST_CSS };
            // A widget always associates visually with the character that
            // FOLLOWS it (empirical, consistent across every iteration), so
            // the pill anchors 'before' the trailing SP — with no SP there is
            // nothing but the pipe to associate with, which is exactly the
            // mis-anchor Johan flagged. Same rule as data cells: no mandatory
            // SP → no pill (the linter flags the malformed separator and
            // Tab/format repairs it).
            // THE association rule (Johan's find, consistent with all the
            // session's evidence): a 'before' attachment belongs — caret and
            // selection-wise — to what PRECEDES it; an 'after' attachment to
            // what FOLLOWS it. The block [last real dash + ghosts] must
            // belong to the dash, so the attachment is always 'before' the
            // character AFTER the block: the trailing SP normally, or the
            // closing pipe when the SP was deleted (separator-only rule).
            if (cell.text.endsWith(':')) push(cell.end - 1, cell.end, 'before', content);
            else if (cell.segEnd > cell.end) push(cell.end, cell.end + 1, 'before', content);
            else if (cell.end > cell.start && editor.document.lineAt(row.line).text.length > cell.segEnd) {
              push(cell.segEnd, cell.segEnd + 1, 'before', content);
            }
          } else {
            // Option B (experiment): the pill anchors to the cell's
            // MANDATORY space (trailing; leading when right-aligned; the
            // only one when empty) and renders on its inner side — interior
            // to the cell band, which backs it in the cell's own color. No
            // mandatory space → no pill (the linter flags it, Tab repairs
            // it). Empty cells render after their space (backed by the
            // space+pipe range pushed above).
            const content = { contentText: NBSP.repeat(needed), backgroundColor: wantColors ? ghostBg(c, shade) : tint, textDecoration: GHOST_CSS };
            // Same association rule as the separator: the attachment goes
            // 'before' the character that FOLLOWS the block, so the block
            // [anchor SP + ghosts] belongs to its anchor, never to the pipe
            // or the text. Requires that following character to exist.
            const lineLen = editor.document.lineAt(row.line).text.length;
            if (cell.text === '') {
              if (lineLen > cell.segEnd) {
                push(cell.segEnd, cell.segEnd + 1, 'before', content);
              }
            } else if (alignRight) {
              // block [SP + ghosts] before the text: attach 'before' the
              // first text character → belongs to the leading SP
              if (cell.start > cell.segStart) {
                push(cell.start, cell.start + 1, 'before', content);
              }
            } else {
              // Johan's sequence model, the separator's exact geometry: the
              // anchor is the LAST real trailing SP (glued to the pipe) and
              // the ghosts deploy to its LEFT — attachment 'before' the
              // anchor SP, the only mid-run shape that never desynced the
              // whitespace-dot layer all session ('after' mid-run does).
              // Extra typed SPs stay left of the pill; the anchor itself is
              // not painted; the pill sits interior to the plain band, so
              // bare pipes cost nothing here.
              // 'before' the anchor SP — the only clean shape here: 'after'
              // on the preceding char (tried, v0.2.111) would hand the block
              // to the SP, but 'after' mid-run desyncs the whitespace-dot
              // layer (third confirmation): the anchor's dot paints left of
              // the pill and the cell next to the pipe goes bare. Physics:
              // SP-at-the-pipe and block-belongs-to-SP cannot coexist.
              // Johan's model, his terms: the ANCLA is the character the
              // block stays glued to when selecting — and it must be the
              // rightmost SP (like the RC glued rightward to the pipe).
              // Rightward glue at this position = 'after' the char preceding
              // the SP. Known cosmetic cost: the SP's whitespace dot may
              // paint at its pre-widget column (inside the pill's left),
              // a VS Code artifact of mid-run 'after' widgets.
              if (cell.segEnd > cell.end && cell.segEnd - 2 >= cell.segStart) {
                push(cell.segEnd - 2, cell.segEnd - 1, 'after', content);
              }
            }
          }
        });
      }
    }
  }

  // ------------------------------------------------------------ ANCHOR LAB
  // TEMPORARY (remove once the attachment rule is validated). Lab lines live
  // in test/tables.md: runs of '=' with the digits 1-6 in order, with or
  // without spaces. Each digit gets a widget whose contentText ENCODES its
  // attachment config, so one screenshot tabulates the whole physics: where
  // each shape RENDERS, and which character it stays GLUED to on selection
  // and caret movement (the anchor). Codes: first letter = attachment side
  // (b=before, a=after); middle letter = target (none = the digit's own
  // one-char range, e = an EMPTY range at the digit, p = the char BEFORE the
  // digit); final digit = which anchor. b1 vs ap6 is the Rosetta pair: same
  // expected render position (just before the digit), possibly different glue.
  const LAB_LINE = /^[= ]+1[= ]+2[= ]+3[= ]+4[= ]+5[= ]+6[= ]*$/;
  const LAB_SPECS = {
    1: (p) => ({ code: 'b1', side: 'before', start: p, end: p + 1 }),
    2: (p) => ({ code: 'a2', side: 'after', start: p, end: p + 1 }),
    3: (p) => ({ code: 'be3', side: 'before', start: p, end: p }),
    4: (p) => ({ code: 'ae4', side: 'after', start: p, end: p }),
    5: (p) => ({ code: 'bp5', side: 'before', start: p - 1, end: p }),
    6: (p) => ({ code: 'ap6', side: 'after', start: p - 1, end: p })
  };
  for (let l = 0; l < editor.document.lineCount; l++) {
    const text = editor.document.lineAt(l).text;
    if (!LAB_LINE.test(text)) continue;
    for (const m of text.matchAll(/\d/g)) {
      const spec = LAB_SPECS[m[0]](m.index);
      ghost.push({
        range: new vscode.Range(l, spec.start, l, spec.end),
        renderOptions: { [spec.side]: { contentText: spec.code, color: ghostColor(), backgroundColor: 'rgba(255, 128, 0, 0.4)' } }
      });
    }
  }
  // ---------------------------------------------------------- END ANCHOR LAB

  editor.setDecorations(ghostType, ghost);
  columnTypes.forEach((type, i) => editor.setDecorations(type, buckets[i]));
}

const refreshVisibleEditors = () => vscode.window.visibleTextEditors.forEach(updateDecorations);

// ---------------------------------------------------------------- commands

async function formatDocument(mode) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') return;
  const text = editor.document.getText();
  const { text: out, tables } = formatText(text, mode);
  if (out === text) {
    vscode.window.setStatusBarMessage('Markdown Ghost Tables: no changes', 3000);
    return;
  }
  await editor.edit((b) => b.replace(fullRange(editor.document), out));
  vscode.window.setStatusBarMessage(`Markdown Ghost Tables: ${tables} table(s) ${mode === 'compact' ? 'compacted' : 'expanded'}`, 3000);
}

// Tab: format the table under the cursor to the current mode and jump between
// cells (delta = +1 / -1)
async function moveCell(delta) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') return;
  const doc = editor.document;
  const posLine = editor.selection.active.line;
  const table = analyzeText(doc.getText()).find((t) => posLine >= t.startLine && posLine <= t.endLine);
  if (!table) return;

  // current cell
  const rowIdx = posLine - table.startLine;
  const row = table.rows[rowIdx];
  const ch = editor.selection.active.character;
  let cellIdx = row.cells.findIndex((c) => ch <= c.end);
  if (cellIdx < 0) cellIdx = Math.max(0, row.cells.length - 1);

  // navigable positions (separator excluded), in order
  const positions = [];
  table.rows.forEach((r, ri) => {
    if (r.isSeparator) return;
    for (let c = 0; c < table.columnCount; c++) positions.push({ ri, c });
  });
  const flat = positions.findIndex((p) => p.ri === rowIdx && p.c === cellIdx);
  let target = flat + delta;
  const needNewRow = target >= positions.length;
  if (target < 0) target = 0;

  // format the block to the current mode (+ new row if Tab at the end)
  const mode = currentMode();
  const blockLines = [];
  for (let l = table.startLine; l <= table.endLine; l++) blockLines.push(doc.lineAt(l).text);
  if (needNewRow) blockLines.push(`${table.rows[0].indent}| ${Array(table.columnCount).fill('').join(' | ')} |`);
  const formatted = formatTable(blockLines, mode).join('\n');
  const endLine = table.endLine;
  await editor.edit((b) => b.replace(new vscode.Range(table.startLine, 0, endLine, doc.lineAt(endLine).text.length), formatted));

  // re-analyze and select the target cell
  const t2 = analyzeText(doc.getText()).find((t) => t.startLine === table.startLine);
  if (!t2) return;
  let destRow, destCol;
  if (needNewRow) {
    destRow = t2.rows[t2.rows.length - 1];
    destCol = 0;
  } else {
    const p = positions[target];
    destRow = t2.rows[p.ri];
    destCol = Math.min(p.c, destRow.cells.length - 1);
  }
  const cell = destRow.cells[destCol];
  if (cell) editor.selection = new vscode.Selection(destRow.line, cell.start, destRow.line, cell.end);
}

// ------------------------------------------------------- status bar + menu

// Tab ownership: ours when enabled AND (Markdown Table is absent, or the mode
// is compact — MT aligns with real spaces, so in expand mode its Tab wins).
function updateTabContext() {
  const mt = !!vscode.extensions.getExtension(MT_ID);
  const ours = !!config().get('tabNavigation') && (!mt || currentMode() === 'compact');
  vscode.commands.executeCommand('setContext', 'markdownGhostTables.tabOurs', ours);
}

// When both extensions bind Tab with a matching clause, VS Code runs the one
// loaded last (Markdown Table). User-level keybindings beat every extension,
// and carrying our tabOurs clause they only fire when the Tab is ours — so MT
// keeps its Tab untouched in expand mode. Offered once when the conflict exists.
const TAB_WHEN = "markdownGhostTables.tabOurs && markdownGhostTables.inTable && editorTextFocus && !editorReadonly && editorLangId == 'markdown' && !suggestWidgetVisible && !editorTabMovesFocus && !inlineSuggestionVisible && !editorHasMultipleSelections";
const TAB_SNIPPET = `{
    "key": "tab",
    "command": "markdownGhostTables.nextCell",
    "when": "${TAB_WHEN}"
},
{
    "key": "shift+tab",
    "command": "markdownGhostTables.prevCell",
    "when": "${TAB_WHEN}"
}`;

async function maybeOfferTabPriority(context) {
  if (context.globalState.get('tabPriorityOffered')) return;
  if (!config().get('tabNavigation') || !vscode.extensions.getExtension(MT_ID)) return;
  await context.globalState.update('tabPriorityOffered', true);
  const pick = await vscode.window.showInformationMessage(
    'Markdown Table also binds Tab and wins between extensions. To let Markdown Ghost Tables take the Tab in compact mode (Markdown Table keeps it in expand mode), add two rules to your user keybindings — see the README, or:',
    'Copy snippet & open keybindings'
  );
  if (pick) {
    await vscode.env.clipboard.writeText(TAB_SNIPPET);
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
  }
}

function updateStatusBar() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    statusItem.hide();
    return;
  }
  const cfg = config();
  const off = [
    !cfg.get('ghostAlign') && 'ghost off',
    !cfg.get('columnColors') && 'colors off'
  ].filter(Boolean).join(', ');
  statusItem.text = `$(table) ${currentMode()}${off ? ` (${off})` : ''}`;
  statusItem.tooltip = 'Markdown Ghost Tables — click to toggle features';
  statusItem.show();
}

async function updateSetting(key, value) {
  // Respect where the setting currently lives: a workspace override keeps
  // winning otherwise (e.g. a repo-declared mode in .vscode/settings.json).
  const info = config().inspect(key);
  const target = info?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config().update(key, value, target);
}

async function showMenu() {
  const cfg = config();
  const items = [
    { key: 'ghostAlign', label: 'Ghost alignment', description: 'virtual column alignment, no spaces written', picked: !!cfg.get('ghostAlign') },
    { key: 'columnColors', label: 'Column colors', description: 'rainbow column backgrounds', picked: !!cfg.get('columnColors') },
    { key: 'mode', label: 'Expand mode', description: 'checked: align with real spaces · unchecked: compact', picked: currentMode() === 'expand' },
    { key: 'tabNavigation', label: 'Tab navigation', description: 'Tab formats the table to the mode and jumps between cells', picked: !!cfg.get('tabNavigation') },
    { key: 'formatOnSave', label: 'Format on save', description: 'normalize all tables to the mode when saving', picked: cfg.get('formatOnSave') === true },
    { key: 'pipeTint', label: 'Pipe tint', description: 'tint each | with its left column color (needed pipes stay tinted)', picked: cfg.get('pipeTint') !== false }
  ];
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Markdown Ghost Tables',
    placeHolder: 'Check the features to enable'
  });
  if (!picked) return; // dismissed
  const on = new Set(picked.map((i) => i.key));
  for (const item of items) {
    const want = on.has(item.key);
    if (want === item.picked) continue;
    if (item.key === 'mode') await updateSetting('mode', want ? 'expand' : 'compact');
    else await updateSetting(item.key, want);
  }
}

// ---------------------------------------------------------------- activation

// Decoration types carry a fixed background, so the live dials rebuild them
// pill's ANCHOR character (the real SP that heads the ghost block) with the
// pill's own shade, so anchor + ghosts read as ONE block.
function buildColumnTypes() {
  columnTypes.forEach((t) => t.dispose());
  const band = config().get('bandShade') ?? 1;
  columnTypes = PALETTE.map((p) =>
    vscode.window.createTextEditorDecorationType({ backgroundColor: `rgba(${p.rgb}, ${Math.min(1, p.alpha * band)})` }));
}

export function activate(context) {
  ghostType = vscode.window.createTextEditorDecorationType({});
  buildColumnTypes();
  context.subscriptions.push(ghostType);

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'markdownGhostTables.menu';
  context.subscriptions.push(statusItem);

  updateTabContext();
  updateStatusBar();
  maybeOfferTabPriority(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownGhostTables.compact', () => formatDocument('compact')),
    vscode.commands.registerCommand('markdownGhostTables.expand', () => formatDocument('expand')),
    vscode.commands.registerCommand('markdownGhostTables.nextCell', () => moveCell(1)),
    vscode.commands.registerCommand('markdownGhostTables.prevCell', () => moveCell(-1)),
    vscode.commands.registerCommand('markdownGhostTables.menu', showMenu),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateDecorations(editor);
      updateStatusBar();
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || e.document !== editor.document) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => updateDecorations(editor), 120);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('markdownGhostTables')) return;
      if (e.affectsConfiguration('markdownGhostTables.bandShade') || e.affectsConfiguration('markdownGhostTables.ghostShade') || e.affectsConfiguration('markdownGhostTables.ghostTint')) buildColumnTypes();
      refreshVisibleEditors();
      updateTabContext();
      updateStatusBar();
      maybeOfferTabPriority(context);
    }),
    vscode.extensions.onDidChange(updateTabContext),

    // context for the Tab keybinding: is the cursor on a table line?
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const doc = e.textEditor.document;
      const inTable = doc.languageId === 'markdown' && /^\s*\|/.test(doc.lineAt(e.selections[0].active.line).text);
      vscode.commands.executeCommand('setContext', 'markdownGhostTables.inTable', inTable);
    }),

    // format-on-save: normalizes to the current mode (e.g. per repo in .vscode/settings.json)
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.languageId !== 'markdown') return;
      if (config().get('formatOnSave') !== true) return;
      const text = e.document.getText();
      const { text: out } = formatText(text, currentMode());
      if (out !== text) e.waitUntil(Promise.resolve([vscode.TextEdit.replace(fullRange(e.document), out)]));
    })
  );

  refreshVisibleEditors();
}

export function deactivate() {}
