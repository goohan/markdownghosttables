// Markdown Ghost Tables — the human surface of the table formatting core
// (src/core.mjs, baked into the bundle at build time: a single implementation
// for the extension and any external CLI consumers).

import * as vscode from 'vscode';
import { analyzeText, formatText, formatTable, measure } from './core.mjs';

// Per-column background palette (low alpha: works on light and dark themes)
const PALETTE = [
  'rgba(86, 156, 214, 0.07)',
  'rgba(78, 201, 176, 0.07)',
  'rgba(220, 220, 170, 0.08)',
  'rgba(197, 134, 192, 0.07)',
  'rgba(215, 186, 125, 0.08)',
  'rgba(156, 220, 254, 0.07)',
  'rgba(181, 206, 168, 0.08)'
];
const NBSP = ' '; // regular spaces can collapse in contentText; nbsp guarantees width

let ghostType;
let columnTypes = [];
let debounceTimer;

const config = () => vscode.workspace.getConfiguration('markdownTables');
const fullRange = (doc) => new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length);
const ghostColor = () => new vscode.ThemeColor('editorGhostText.foreground');

// ---------------------------------------------------------------- decorations

function updateDecorations(editor) {
  if (!editor || editor.document.languageId !== 'markdown') return;
  const cfg = config();
  const wantGhost = cfg.get('ghostAlign');
  const wantColors = cfg.get('columnColors');
  const tint = cfg.get('ghostTint');
  const ghost = [];
  const buckets = columnTypes.map(() => []);

  if (wantGhost || wantColors) {
    for (const table of analyzeText(editor.document.getText())) {
      for (const row of table.rows) {
        row.cells.forEach((cell, c) => {
          if (wantColors && cell.end > cell.start && !row.isSeparator) {
            buckets[c % columnTypes.length].push(new vscode.Range(row.line, cell.start, row.line, cell.end));
          }
          if (!wantGhost) return;
          const needed = (table.widths[c] ?? 3) - measure(cell.text);
          if (needed <= 0) return;
          if (row.isSeparator) {
            // the separator is padded with ghost dashes, before the trailing `:` if any
            const at = cell.text.endsWith(':') ? cell.end - 1 : cell.end;
            ghost.push({
              range: new vscode.Range(row.line, at, row.line, at),
              renderOptions: { after: { contentText: '-'.repeat(needed), color: ghostColor(), backgroundColor: tint } }
            });
          } else {
            const alignRight = table.alignments[c] === 'right';
            const at = alignRight ? cell.start : cell.end;
            const attachment = { contentText: NBSP.repeat(needed), backgroundColor: tint };
            ghost.push({
              range: new vscode.Range(row.line, at, row.line, at),
              renderOptions: alignRight ? { before: attachment } : { after: attachment }
            });
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

// Tab: format the table under the cursor and jump between cells (delta = +1 / -1)
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

  // format the block to the editing mode (+ new row if Tab at the end)
  const mode = config().get('tabFormatMode');
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

// ---------------------------------------------------------------- activation

export function activate(context) {
  ghostType = vscode.window.createTextEditorDecorationType({});
  columnTypes = PALETTE.map((color) => vscode.window.createTextEditorDecorationType({ backgroundColor: color }));
  context.subscriptions.push(ghostType, ...columnTypes);

  // coexistence: if Markdown Table is installed, the Tab key is theirs
  vscode.commands.executeCommand('setContext', 'markdownTables.mtInstalled', !!vscode.extensions.getExtension('takumii.markdowntable'));

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTables.compact', () => formatDocument('compact')),
    vscode.commands.registerCommand('markdownTables.expand', () => formatDocument('expand')),
    vscode.commands.registerCommand('markdownTables.nextCell', () => moveCell(1)),
    vscode.commands.registerCommand('markdownTables.prevCell', () => moveCell(-1)),

    vscode.window.onDidChangeActiveTextEditor(updateDecorations),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || e.document !== editor.document) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => updateDecorations(editor), 120);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('markdownTables')) refreshVisibleEditors();
    }),

    // context for the Tab keybinding: is the cursor on a table line?
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const doc = e.textEditor.document;
      const inTable = doc.languageId === 'markdown' && /^\s*\|/.test(doc.lineAt(e.selections[0].active.line).text);
      vscode.commands.executeCommand('setContext', 'markdownTables.inTable', inTable);
    }),

    // format-on-save: normalizes to the declared resting state (e.g. per repo in .vscode/settings.json)
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.languageId !== 'markdown') return;
      const mode = config().get('formatOnSave');
      if (mode !== 'compact' && mode !== 'expand') return;
      const text = e.document.getText();
      const { text: out } = formatText(text, mode);
      if (out !== text) e.waitUntil(Promise.resolve([vscode.TextEdit.replace(fullRange(e.document), out)]));
    })
  );

  refreshVisibleEditors();
}

export function deactivate() {}
