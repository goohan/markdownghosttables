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
// hatch — pure paint, zero geometry), ONLY while column colors are off: in
// gray mode two blocks meeting at a pipe (a left-aligned cell next to a
// right-aligned one anchors both ghosts to the same `|`) read as one solid
// slab without them. With colors on, hues already separate neighbors and the
// corners would notch dark editor background out of the column band.
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
  const ghost = [];
  const buckets = columnTypes.map(() => []);

  if (wantGhost || wantColors) {
    for (const table of analyzeText(editor.document.getText())) {
      for (const row of table.rows) {
        row.cells.forEach((cell, c) => {
          if (wantColors && cell.segEnd > cell.segStart) {
            // the band paints the cell's real characters only — pipes stay
            // bare (Johan's call over pipe-tinted contiguous bands). Its
            // background covers widgets injected BETWEEN its characters (the
            // separator's ghost) but not widgets hanging at its edges: the
            // pipe-glued data ghosts paint their own background instead.
            buckets[c % columnTypes.length].push(new vscode.Range(row.line, cell.segStart, row.line, cell.segEnd));
          }
          if (!wantGhost) return;
          // truly differential, measured on the whole segment: aligned, a
          // cell's segment (between its `|`s) spans width+2 columns (canonical
          // single space on each side); the ghost only supplies what the real
          // characters — text and padding alike — don't. Counting the segment
          // instead of text+trailing keeps it symmetric for right-aligned
          // columns and makes empty cells fall out naturally.
          const alignRight = table.alignments[c] === 'right' && !row.isSeparator;
          const needed = (table.widths[c] ?? 3) + 2 - (cell.segEnd - cell.segStart);
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
            // interior widget: the band paints behind it — no background of
            // its own with colors on
            // the separator's ghost is interior, so its own paint STACKS over
            // the band (unlike the pipe-glued data ghosts) — same dial, its
            // pill just starts from the band's shade
            const content = { contentText: '-'.repeat(needed), color: ghostColor(), backgroundColor: wantColors ? ghostBg(c, shade) : tint, textDecoration: wantColors ? 'none' : GHOST_CSS };
            if (cell.text.endsWith(':')) push(cell.end - 1, cell.end, 'before', content);
            else if (cell.segEnd > cell.end) push(cell.end, cell.end + 1, 'before', content);
            else push(cell.end, cell.end, 'after', content);
          } else {
            // data cells: the ghost glues to the cell's FAR pipe, so all real
            // content — text plus its reglamentary space — stays contiguous
            // and the caret lands naturally at the end of the text when
            // typing (with the ghost in between, the cursor could only sit
            // after the block). Mirrored for right-aligned columns.
            const content = { contentText: NBSP.repeat(needed), backgroundColor: wantColors ? ghostBg(c, shade) : tint, textDecoration: wantColors ? 'none' : GHOST_CSS };
            if (alignRight) {
              if (cell.segEnd > cell.segStart) push(cell.segStart, cell.segStart + 1, 'before', content);
              else push(cell.start, cell.start, 'before', content);
            } else {
              if (cell.segEnd > cell.segStart) push(cell.segEnd - 1, cell.segEnd, 'after', content);
              else push(cell.end, cell.end, 'after', content);
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
    { key: 'formatOnSave', label: 'Format on save', description: 'normalize all tables to the mode when saving', picked: cfg.get('formatOnSave') === true }
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

export function activate(context) {
  ghostType = vscode.window.createTextEditorDecorationType({});
  columnTypes = PALETTE.map((p) => vscode.window.createTextEditorDecorationType({ backgroundColor: `rgba(${p.rgb}, ${p.alpha})` }));
  context.subscriptions.push(ghostType, ...columnTypes);

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
