/** The links in a room's output, found once for both doors (the tap provider and the links panel).
 * A hard wrap joins only when the URL reaches the right edge and the row below is all URL characters.
 * Reference: docs/phone/room-delivery.md */

export interface RoomRow {
  text: string;
  /** True when xterm wrapped the previous row into this one. */
  wrapped: boolean;
}

export interface Cell {
  row: number;
  col: number;
}

/** One URL found in the rows, with the cells it covers (end inclusive). */
export interface RoomLink {
  url: string;
  start: Cell;
  end: Cell;
}

const URL_CHAR = "A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%";
const URL_RUN = new RegExp(`https?://[${URL_CHAR}]+`, "g");
const URL_AT_END = new RegExp(`https?://[${URL_CHAR}]+$`);
const ALL_URL_CHARS = new RegExp(`^[${URL_CHAR}]+$`);
const STARTS_A_URL = /^https?:\/\//;

/** How close to the right edge a row must reach for a hard wrap to be read. */
const EDGE_SLACK = 2;

const TRAILING = /[.,;:!?'"]+$/;

/** A matched run without trailing punctuation or a closing bracket the URL never opened. */
function trimTail(run: string): string {
  let url = run.replace(TRAILING, "");
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
  ]) {
    while (url.endsWith(close) && url.split(open).length < url.split(close).length) {
      url = url.slice(0, -1).replace(TRAILING, "");
    }
  }
  return url;
}

function leadingBlanks(text: string): number {
  return text.length - text.trimStart().length;
}

/** Whether row `next` carries on, across a hard wrap, the URL `line` ends with. */
function continuesUrl(line: string, lastRow: string, next: string, cols: number, indent: number): boolean {
  if (lastRow.trimEnd().length < cols - EDGE_SLACK) return false;
  if (!URL_AT_END.test(line.trimEnd())) return false;
  const body = next.trim();
  if (!body || STARTS_A_URL.test(body) || !ALL_URL_CHARS.test(body)) return false;
  const lead = leadingBlanks(next);
  return lead === 0 || lead === indent;
}

/** Every http(s) URL in `rows`, top first, each joined across the rows it was wrapped over. */
// One cell per character: a wide character earlier on the row shifts the underline, never the URL.
export function findLinks(rows: RoomRow[], cols: number, firstRow = 0): RoomLink[] {
  const links: RoomLink[] = [];
  let r = 0;
  while (r < rows.length) {
    let line = "";
    const cells: Cell[] = [];
    const add = (row: number, from: number, text: string) => {
      for (let i = 0; i < text.length; i += 1) cells.push({ row: firstRow + row, col: from + i });
      line += text;
    };

    add(r, 0, rows[r].text);
    const indent = leadingBlanks(rows[r].text);
    let last = r;
    while (last + 1 < rows.length) {
      const next = rows[last + 1];
      if (next.wrapped) {
        // A soft-wrapped row ran to the edge, so its trimmed blanks go back or two words fuse across the wrap.
        const short = cols - rows[last].text.length;
        if (short > 0) add(last, rows[last].text.length, " ".repeat(short));
        add(last + 1, 0, next.text);
      } else if (continuesUrl(line, rows[last].text, next.text, cols, indent)) {
        line = line.trimEnd();
        cells.length = line.length;
        add(last + 1, leadingBlanks(next.text), next.text.trim());
      } else {
        break;
      }
      last += 1;
    }

    for (const match of line.matchAll(URL_RUN)) {
      const url = trimTail(match[0]);
      const at = match.index ?? 0;
      if (url.replace(STARTS_A_URL, "").length > 0) {
        links.push({ url, start: cells[at], end: cells[at + url.length - 1] });
      }
    }
    r = last + 1;
  }
  return links;
}

export function coversRow(link: RoomLink, row: number): boolean {
  return link.start.row <= row && row <= link.end.row;
}

/** The distinct URLs, most recent (lowest in the buffer) first. */
export function recentUrls(links: RoomLink[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of [...links].sort((a, b) => b.end.row - a.end.row)) {
    if (out.length === limit) break;
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link.url);
  }
  return out;
}

export interface RowSource {
  readonly length: number;
  getLine(y: number): { readonly isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined;
}

export function readRows(buffer: RowSource, from: number, to: number): RoomRow[] {
  const rows: RoomRow[] = [];
  for (let y = Math.max(0, from); y < Math.min(buffer.length, to); y += 1) {
    const line = buffer.getLine(y);
    rows.push({ text: line?.translateToString(true) ?? "", wrapped: line?.isWrapped ?? false });
  }
  return rows;
}
