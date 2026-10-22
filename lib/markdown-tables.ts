/**
 * Splits Markdown into prose and GFM pipe-table blocks.
 *
 * The document viewer's react-markdown has no GFM plugin installed, so pipe
 * tables would render as raw text. Tables are pulled out here and rendered
 * by the viewer; everything else goes through react-markdown unchanged.
 * Pure (no React, no aliases) so node tests can cover it.
 */

export type TableAlign = "left" | "right" | "center" | null;

export type MarkdownSegment =
  | { kind: "markdown"; text: string }
  | { kind: "table"; header: string[]; align: TableAlign[]; rows: string[][] };

const DELIMITER_CELL = /^:?-{3,}:?$/;
const FENCE = /^\s*(```|~~~)/;

/** Splits one pipe row into trimmed cells. Honors escaped pipes (\|). */
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseDelimiter(line: string): TableAlign[] | null {
  if (!line.includes("|")) return null;
  const cells = splitTableRow(line);
  if (cells.length === 0 || !cells.every((c) => DELIMITER_CELL.test(c))) return null;
  return cells.map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

/** Pads or trims a row to the header width, as GFM does. */
function fitRow(cells: string[], width: number): string[] {
  return Array.from({ length: width }, (_, i) => cells[i] ?? "");
}

export function splitMarkdownTables(markdown: string): MarkdownSegment[] {
  const lines = markdown.split(/\r?\n/);
  const segments: MarkdownSegment[] = [];
  let prose: string[] = [];
  let inFence = false;

  const flushProse = () => {
    const text = prose.join("\n");
    if (text.trim() !== "") segments.push({ kind: "markdown", text });
    prose = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      inFence = !inFence;
      prose.push(line);
      i++;
      continue;
    }

    if (!inFence && line.includes("|") && i + 1 < lines.length) {
      const align = parseDelimiter(lines[i + 1]);
      const header = splitTableRow(line);
      if (align && align.length === header.length) {
        flushProse();
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim() !== "" && lines[j].includes("|") && !FENCE.test(lines[j])) {
          rows.push(fitRow(splitTableRow(lines[j]), header.length));
          j++;
        }
        segments.push({ kind: "table", header, align, rows });
        i = j;
        continue;
      }
    }

    prose.push(line);
    i++;
  }
  flushProse();
  return segments;
}
