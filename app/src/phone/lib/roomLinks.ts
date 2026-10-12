/**
 * The links in a room's output, found ONCE for both doors that use them
 * (2026-10-12, devpulse's brief: a claude login has to finish from the phone).
 *
 * A login prints an OAuth URL into the room, and on the phone that URL was
 * plain text: no tap opened it, and nothing lifted it off the screen. Two doors
 * read this module - the link provider TerminalSheet registers on xterm, so a
 * tap on the URL opens it, and the links panel, which lists every URL in the
 * scrollback because a thin wrapped line on a six-inch screen is a hard target.
 * One detection behind both, so the panel can never list a link the tap cannot
 * see, or the reverse.
 *
 * WHY NOT THE WEB-LINKS ADDON, which the desktop loads. The addon joins rows
 * only where xterm itself wrapped them (`isWrapped`). A URL can also arrive
 * HARD-wrapped - a full-screen interface that breaks long text into lines of
 * its own, or tmux repainting a pane - and then each row is its own line to
 * xterm, so the addon underlines one row of the URL and a tap opens a third of
 * it. A tap on a wrapped URL has to open the whole URL, so the join is done
 * here, where tests can pin it.
 *
 * A HARD WRAP IS A JUDGEMENT, made narrowly. A row joins the URL above it only
 * when that URL runs to the right edge of its row, and the row below is nothing
 * BUT URL characters - no space anywhere in it - starting at the left edge or at
 * the indent of the line the URL began on. A sentence under a URL ("Paste code
 * here") has spaces, so it never joins.
 */

/** One terminal row, as the buffer hands it over. */
export interface RoomRow {
  /** The row's text, trailing blanks trimmed. */
  text: string;
  /** True when xterm wrapped the previous row into this one. */
  wrapped: boolean;
}

/** A cell position: buffer row and column, both 0-based. */
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

/** The characters RFC 3986 allows in a URL, as one class. */
const URL_CHAR = "A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%";
const URL_RUN = new RegExp(`https?://[${URL_CHAR}]+`, "g");
const URL_AT_END = new RegExp(`https?://[${URL_CHAR}]+$`);
const ALL_URL_CHARS = new RegExp(`^[${URL_CHAR}]+$`);
const STARTS_A_URL = /^https?:\/\//;

/**
 * How close to the right edge a row must reach for a hard wrap to be read.
 * An interface that wraps one or two cells short of the edge is common; a row
 * that stops further in than that is a line that ended, not one that broke.
 */
const EDGE_SLACK = 2;

/** Sentence punctuation that sits after a URL and is not part of it. */
const TRAILING = /[.,;:!?'"]+$/;

/** A matched run without what a sentence put after it: trailing punctuation,
 *  and a closing bracket the URL never opened. */
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

/**
 * Every http(s) URL in `rows`, each joined across the rows it was wrapped over.
 *
 * Columns assume one cell per character, which holds for a URL; a wide
 * character earlier on the same row shifts the underline, never the URL.
 *
 * Args:
 *   rows: Consecutive buffer rows, top first.
 *   cols: The terminal's width in cells.
 *   firstRow: The buffer row `rows[0]` is, so cells come back in buffer terms.
 *
 * Returns:
 *   The links, top first.
 */
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
        // The row above was trimmed; a soft wrap means it really ran to the
        // edge, so its blanks go back or two words would fuse across the wrap.
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

/** Whether `link` covers any cell of buffer row `row`. */
export function coversRow(link: RoomLink, row: number): boolean {
  return link.start.row <= row && row <= link.end.row;
}

/**
 * The distinct URLs, most recent (lowest in the buffer) first.
 *
 * Args:
 *   links: What `findLinks` returned.
 *   limit: How many to keep.
 */
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

/** The slice of an xterm buffer this module reads. */
export interface RowSource {
  readonly length: number;
  getLine(y: number): { readonly isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined;
}

/**
 * Buffer rows `from` up to (not including) `to`.
 *
 * Args:
 *   buffer: xterm's active buffer, or anything shaped like it.
 *   from: The first buffer row.
 *   to: One past the last.
 */
export function readRows(buffer: RowSource, from: number, to: number): RoomRow[] {
  const rows: RoomRow[] = [];
  for (let y = Math.max(0, from); y < Math.min(buffer.length, to); y += 1) {
    const line = buffer.getLine(y);
    rows.push({ text: line?.translateToString(true) ?? "", wrapped: line?.isWrapped ?? false });
  }
  return rows;
}
