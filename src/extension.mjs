// Markdown Ghost Tables — the human surface of the table formatting core
// (src/core.mjs, baked into the bundle at build time: a single implementation
// for the extension and any external CLI consumers).

import * as vscode from 'vscode';
import { analyzeText, formatText, formatTable, measure } from './core.mjs';

// Per-column background palette (low alpha: works on light and dark themes).
// A column paints its whole cells — text, real padding, separator row — as
// one flat band. The pills (ghost padding) hang at a band edge, so the band
// cannot cover them and they paint their own background: see ghostBg. Real
// vs virtual is told by the whitespace dots.
const PALETTE = [
  { rgb: '70, 150, 235', alpha: 0.07 },
  { rgb: '55, 212, 155', alpha: 0.07 },
  { rgb: '228, 222, 140', alpha: 0.08 },
  { rgb: '208, 122, 208', alpha: 0.07 },
  { rgb: '230, 178, 100', alpha: 0.08 },
  { rgb: '125, 215, 255', alpha: 0.07 },
  { rgb: '160, 212, 138', alpha: 0.08 }
];
// A pill hangs at its band's edge (anchor-lab rule: a widget at a range
// boundary is never covered by the rectangle), so it paints its own
// background: the column hue with its alpha times the ghostShade setting —
// a live dial, because attachment and range backgrounds do not composite
// identically at equal rgba (empirical: 1.0 rendered darker than the band,
// 0.5 lighter). At the value where the cell looks uniform the dial doubles
// as the "pastille" control: above it the pill stands out, which is what
// the shipped default (2) deliberately does.
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
  const shade = cfg.get('ghostShade') ?? 2;
  const pipeTint = cfg.get('pipeTint') === true;
  const ghost = [];
  const buckets = columnTypes.map(() => []);

  if (wantGhost || wantColors) {
    for (const table of analyzeText(editor.document.getText())) {
      for (const row of table.rows) {
        row.cells.forEach((cell, c) => {
          const rightColumn = table.alignments[c] === 'right';
          const needed = (table.widths[c] ?? 3) + 2 - (cell.segEnd - cell.segStart);
          if (wantColors && (cell.segEnd > cell.segStart || (pipeTint && c === 0))) {
            // The editor paints range backgrounds as full-line rectangles
            // that cover widgets injected BETWEEN the range's characters —
            // never the ones hanging at its edges (anchor lab). That is what
            // pipeTint buys beyond cosmetics: it pulls the closing pipe into
            // the band, which then backs the pill glued to that pipe. With
            // pipeTint off (the default) the pipes read bare and those pills
            // self-paint with no canvas behind — thin slivers may show
            // around them, especially under zoom: the accepted cost of that
            // look (the alternative was the naked-sliver saga of 0.2.9-18).
            // pipeTint also closes the row's LEADING pipe, which the rule
            // (each pipe takes the color of the column to its LEFT) leaves
            // claimed by no column: column 0's band starts one char earlier,
            // so on it the table reads as bands with both edges closed, and
            // off it every single pipe reads bare (Johan's call).
            const bucket = buckets[c % columnTypes.length];
            bucket.push(new vscode.Range(row.line, pipeTint && c === 0 ? cell.segStart - 1 : cell.segStart, row.line, pipeTint ? cell.segEnd + 1 : cell.segEnd));
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
          // THE anchor rule (validated in the anchor lab, test/tables.md):
          // the range only fixes the render SLOT — 'before' renders at range
          // start, 'after' at range end; range content, width, even
          // emptiness are irrelevant. The GLUE belongs to the slot, not the
          // range: a 'before' widget stays glued — caret and selection — to
          // the real char immediately LEFT of its slot, an 'after' widget to
          // the one on its RIGHT; the block [anchor + widget] is atomic.
          // One artifact: a SP immediately RIGHT of an 'after' widget paints
          // its whitespace dot at the pre-widget column (VS Code, no fix
          // from a decoration) — no shape may leave a SP right of an 'after'.
          const push = (start, end, side, content) =>
            ghost.push({ range: new vscode.Range(row.line, start, row.line, end), renderOptions: { [side]: content } });
          if (row.isSeparator) {
            // every ghost is backed by the band now, so its own paint STACKS
            // over it — one dial for all rows: 0 = fully uniform cell,
            // higher = the pill stands out from the band's shade
            const content = { contentText: '-'.repeat(needed), color: ghostColor(), backgroundColor: wantColors ? ghostBg(c, shade) : tint, textDecoration: GHOST_CSS };
            // Ghost dashes must adjoin the real dash run (the data cells'
            // between-SP-and-pipe slot makes no sense here), so the slot is
            // right after the last dash and the block [last dash + ghosts]
            // stays glued to it: 'before' the char after the run — the ':'
            // if any, else the trailing SP, else the closing pipe when the
            // SP was deleted (separator-only fallback; a missing mandatory
            // SP in a data cell means no pill instead).
            if (cell.text.endsWith(':')) push(cell.end - 1, cell.end, 'before', content);
            else if (cell.segEnd > cell.end) push(cell.end, cell.end + 1, 'before', content);
            else if (cell.end > cell.start && editor.document.lineAt(row.line).text.length > cell.segEnd) {
              push(cell.segEnd, cell.segEnd + 1, 'before', content);
            }
          } else {
            // Data pills — shape C, the anchor lab's pick: every pill is a
            // 'before' widget whose glue char is the cell's MANDATORY space.
            // Left cells and empty cells: slot between the trailing SP and
            // the closing pipe — the block [SP + ghosts] hangs at the pipe
            // (Johan's model) with clean whitespace dots. Right-aligned
            // cells: slot before the first text char — the mirror, block
            // [leading SP + ghosts]. No mandatory space → no pill (the
            // linter flags it, Tab repairs it). Discarded shapes: 'after'
            // the last text char (v0.2.111/115) left the SP right of an
            // 'after' widget — the dot artifact; 'before' the SP (v0.2.114
            // and the RC) glued the block to the TEXT, against the model.
            const content = { contentText: NBSP.repeat(needed), backgroundColor: wantColors ? ghostBg(c, shade) : tint, textDecoration: GHOST_CSS };
            const lineLen = editor.document.lineAt(row.line).text.length;
            if (cell.text === '') {
              if (lineLen > cell.segEnd) {
                push(cell.segEnd, cell.segEnd + 1, 'before', content);
              }
            } else if (alignRight) {
              if (cell.start > cell.segStart) {
                push(cell.start, cell.start + 1, 'before', content);
              }
            } else if (cell.segEnd > cell.end && lineLen > cell.segEnd) {
              push(cell.segEnd, cell.segEnd + 1, 'before', content);
            }
          }
        });
      }
    }
  }

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
    !cfg.get('ghostAlign') && 'Ghost off',
    !cfg.get('columnColors') && 'Colors off'
  ].filter(Boolean).join(', ');
  statusItem.text = `$(table) ${currentMode() === 'expand' ? 'Expand' : 'Compact'}${off ? ` (${off})` : ''}`;
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
    { key: 'pipeTint', label: 'Pipe tint', description: 'tint every | so the columns read as continuous bands (off: all pipes bare)', picked: cfg.get('pipeTint') === true }
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

// Decoration types carry a fixed background, so the live dials rebuild them:
// bandShade multiplies each column's alpha for the band.
function buildColumnTypes() {
  columnTypes.forEach((t) => t.dispose());
  const band = config().get('bandShade') ?? 2;
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
