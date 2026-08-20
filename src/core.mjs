// Markdown table formatting core — the single source of the algorithm.
// Canonical home: https://github.com/goohan/markdownghosttables (this repo).
// No dependencies and no VS Code API: it is consumed by the extension
// (src/extension.mjs, baked into the bundle at build time) and by external
// CLIs that keep a baked copy of this file (byte-identical, refreshed on sync).
//
// Rules:
// - A table is a block of consecutive lines starting with `|` (after optional
//   indentation) whose SECOND line is the separator (`---` with optional `:`).
//   A block of pipe lines without a separator is left untouched.
// - Fenced code blocks (``` or ~~~) are ignored entirely: a table inside a
//   fence is documentation, not content to format.
// - An escaped `\|` does not split cells. Alignment colons in the separator
//   are preserved in both modes.
// - Widths are measured in code points ([...s].length): enough for latin
//   text; double-width emoji/CJK are approximated (known and accepted
//   limitation — alignment is presentation, not content).

const FENCE_RE = /^\s*(```|~~~)/;
const TABLE_LINE_RE = /^\s*\|/;
const SEPARATOR_CELL_RE = /^:?-+:?$/;

const width = (s) => [...s].length;

// Splits a row into cells WITH positions (start/end columns of the trimmed
// text within the original line) — what the extension's decorations need.
// splitRow (below) is the simple view used by the formatter.
export function splitRowDetailed(line) {
  const indent = line.match(/^\s*/)[0];
  const cells = [];
  let pos = indent.length;
  if (line[pos] === '|') pos++;
  let segStart = pos;
  for (let i = pos; i <= line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) { i++; continue; }
    if (ch === '|' || i === line.length) {
      const raw = line.slice(segStart, i);
      // the empty segment after the trailing `|` is not a cell
      if (!(i === line.length && raw.trim() === '' && cells.length > 0)) {
        const leading = raw.match(/^\s*/)[0].length;
        const text = raw.trim();
        const start = segStart + leading;
        cells.push({ text, start, end: start + text.length });
      }
      segStart = i + 1;
    }
  }
  return { indent, cells };
}

// Splits a row into cells, honoring escaped `\|`; preserves indentation.
export function splitRow(line) {
  const indent = line.match(/^\s*/)[0];
  let inner = line.trim();
  if (inner.startsWith('|')) inner = inner.slice(1);
  if (inner.endsWith('|') && !inner.endsWith('\\|')) inner = inner.slice(0, -1);
  const cells = [];
  let current = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && i + 1 < inner.length) {
      current += ch + inner[i + 1];
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return { indent, cells };
}

const isSeparatorRow = (cells) => cells.length > 0 && cells.every((c) => SEPARATOR_CELL_RE.test(c));

// Alignment declared by a separator cell: 'left' | 'right' | 'center' | 'none'.
function separatorAlignment(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return 'none';
}

function separatorCell(alignment, bodyWidth) {
  const dashes = (n) => '-'.repeat(Math.max(1, n));
  switch (alignment) {
    case 'center': return `:${dashes(bodyWidth - 2)}:`;
    case 'right': return `${dashes(bodyWidth - 1)}:`;
    case 'left': return `:${dashes(bodyWidth - 1)}`;
    default: return dashes(bodyWidth);
  }
}

// Formats ONE table (list of lines) to the requested mode: 'compact' | 'expand'.
export function formatTable(lines, mode) {
  const rows = lines.map(splitRow);
  const alignments = rows[1].cells.map(separatorAlignment);
  const columnCount = Math.max(...rows.map((r) => r.cells.length));

  if (mode === 'compact') {
    return rows.map((row, rowIndex) => {
      const cells = row.cells.map((cell, i) =>
        rowIndex === 1 ? separatorCell(alignments[i] ?? 'none', 3) : cell);
      return `${row.indent}| ${cells.join(' | ')} |`;
    });
  }

  // expand: each column to the width of its longest cell (min 3, for the separator)
  const widths = Array.from({ length: columnCount }, (_, i) =>
    Math.max(3, ...rows.map((r, ri) => (ri === 1 ? 0 : width(r.cells[i] ?? '')))));
  return rows.map((row, rowIndex) => {
    const cells = Array.from({ length: columnCount }, (_, i) => {
      if (rowIndex === 1) return separatorCell(alignments[i] ?? 'none', widths[i]);
      const cell = row.cells[i] ?? '';
      return cell + ' '.repeat(widths[i] - width(cell));
    });
    return `${row.indent}| ${cells.join(' | ')} |`;
  });
}

// Model of every table in a markdown text (for the extension's decorations):
// per table, start/end lines, rows with positioned cells, separator alignments
// and target expansion widths per column.
export function analyzeText(text) {
  const lines = text.split('\n');
  const tables = [];
  let inFence = false;
  let fenceMarker = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      if (!inFence) { inFence = true; fenceMarker = fenceMatch[1]; }
      else if (fenceMatch[1] === fenceMarker) { inFence = false; }
      continue;
    }
    if (inFence || !TABLE_LINE_RE.test(line)) continue;
    const start = i;
    let j = i;
    while (j < lines.length && TABLE_LINE_RE.test(lines[j])) j++;
    const block = lines.slice(start, j);
    if (block.length >= 2 && isSeparatorRow(splitRow(block[1]).cells)) {
      const rows = block.map((l, k) => ({ line: start + k, isSeparator: k === 1, ...splitRowDetailed(l) }));
      const columnCount = Math.max(...rows.map((r) => r.cells.length));
      const alignments = rows[1].cells.map((c) => separatorAlignment(c.text));
      const widths = Array.from({ length: columnCount }, (_, c) =>
        Math.max(3, ...rows.map((r) => (r.isSeparator ? 0 : width(r.cells[c]?.text ?? '')))));
      tables.push({ startLine: start, endLine: j - 1, rows, columnCount, alignments, widths });
    }
    i = j - 1;
  }
  return tables;
}

export const measure = width;

// Formats every table in a markdown text. Returns { text, tables }: the
// resulting text and how many tables changed (0 if nothing did).
export function formatText(text, mode) {
  const lines = text.split('\n');
  const output = [];
  let inFence = false;
  let fenceMarker = '';
  let tablesChanged = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      if (!inFence) { inFence = true; fenceMarker = fenceMatch[1]; }
      else if (fenceMatch[1] === fenceMarker) { inFence = false; }
      output.push(line);
      continue;
    }
    if (inFence || !TABLE_LINE_RE.test(line)) {
      output.push(line);
      continue;
    }
    // gather the block of consecutive table lines
    const block = [];
    let j = i;
    while (j < lines.length && TABLE_LINE_RE.test(lines[j])) { block.push(lines[j]); j++; }
    const isTable = block.length >= 2 && isSeparatorRow(splitRow(block[1]).cells);
    if (!isTable) {
      output.push(...block);
    } else {
      const formatted = formatTable(block, mode);
      if (formatted.join('\n') !== block.join('\n')) tablesChanged++;
      output.push(...formatted);
    }
    i = j - 1;
  }

  return { text: output.join('\n'), tables: tablesChanged };
}
