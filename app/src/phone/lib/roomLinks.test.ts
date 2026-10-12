import { describe, expect, it } from "vitest";

import { type RoomRow, coversRow, findLinks, readRows, recentUrls } from "./roomLinks";

const row = (text: string, wrapped = false): RoomRow => ({ text, wrapped });
const LOGIN = "https://claude.ai/oauth/authorize?code=true&client_id=9d1c&state=Zx7";

describe("findLinks", () => {
  it("finds a URL on one row with its first and last cell", () => {
    expect(findLinks([row(`open ${LOGIN} now`)], 120)).toEqual([
      { url: LOGIN, start: { row: 0, col: 5 }, end: { row: 0, col: 5 + LOGIN.length - 1 } },
    ]);
  });

  it("joins a URL xterm soft-wrapped over three rows into one, not three pieces", () => {
    const rows = [row(LOGIN.slice(0, 30)), row(LOGIN.slice(30, 60), true), row(LOGIN.slice(60), true)];
    const links = findLinks(rows, 30);
    expect(links.map((link) => link.url)).toEqual([LOGIN]);
    expect(links[0].end).toEqual({ row: 2, col: LOGIN.length - 61 });
  });

  it("joins a hard-wrapped URL that runs to the right edge, at the line's own indent", () => {
    const rows = [row(`  ${LOGIN.slice(0, 28)}`), row(`  ${LOGIN.slice(28, 56)}`), row(`  ${LOGIN.slice(56)}`)];
    const links = findLinks(rows, 30);
    expect(links.map((link) => link.url)).toEqual([LOGIN]);
    expect(links[0].start).toEqual({ row: 0, col: 2 });
  });

  it("never joins a sentence under a URL, even when the URL reaches the edge", () => {
    const url = LOGIN.slice(0, 30);
    expect(findLinks([row(url), row("Paste code here")], 30).map((link) => link.url)).toEqual([url]);
  });

  it("never joins a row indented differently from the line the URL began on", () => {
    const url = LOGIN.slice(0, 30);
    expect(findLinks([row(url), row("    token42")], 30).map((link) => link.url)).toEqual([url]);
  });

  it("never joins the next row when the URL stops short of the edge", () => {
    const url = "https://example.com/a";
    expect(findLinks([row(url), row("bcdef")], 40).map((link) => link.url)).toEqual([url]);
  });

  it("keeps a second URL on the next row its own link, not a tail of the first", () => {
    const first = LOGIN.slice(0, 30);
    expect(findLinks([row(first), row("https://example.com/b")], 30).map((link) => link.url)).toEqual([
      first,
      "https://example.com/b",
    ]);
  });

  it("does not fuse two words across a soft wrap where the row ended in a blank", () => {
    const rows = [row("see https://example.com/a"), row("and more", true)];
    expect(findLinks(rows, 26).map((link) => link.url)).toEqual(["https://example.com/a"]);
  });

  it("drops sentence punctuation and an unopened bracket after the URL, keeps a balanced one", () => {
    expect(findLinks([row("(see https://example.com/x).")], 80)[0].url).toBe("https://example.com/x");
    expect(findLinks([row("https://en.wikipedia.org/wiki/Tmux_(software)")], 80)[0].url).toBe(
      "https://en.wikipedia.org/wiki/Tmux_(software)",
    );
  });

  it("finds nothing in a bare scheme or a non-http scheme", () => {
    expect(findLinks([row("https:// and ftp://example.com and file:///etc")], 80)).toEqual([]);
  });

  it("reports cells in buffer rows when the window starts below row 0", () => {
    expect(findLinks([row("x"), row("https://example.com")], 80, 500)[0].start).toEqual({ row: 501, col: 0 });
  });
});

describe("coversRow", () => {
  it("is true on every row a wrapped URL spans and false outside them", () => {
    const [link] = findLinks([row(LOGIN.slice(0, 30)), row(LOGIN.slice(30), true)], 30, 10);
    expect([9, 10, 11, 12].map((y) => coversRow(link, y))).toEqual([false, true, true, false]);
  });
});

describe("recentUrls", () => {
  it("lists the lowest URL first, once each, up to the limit", () => {
    const links = findLinks(
      [row("https://a.example"), row("https://b.example"), row("https://a.example"), row("https://c.example")],
      80,
    );
    expect(recentUrls(links, 10)).toEqual(["https://c.example", "https://a.example", "https://b.example"]);
    expect(recentUrls(links, 2)).toEqual(["https://c.example", "https://a.example"]);
  });
});

describe("readRows", () => {
  it("reads trimmed text and the wrap flag, and stops at the buffer's end", () => {
    const lines = [
      { isWrapped: false, translateToString: (trim?: boolean) => (trim ? "top" : "top   ") },
      { isWrapped: true, translateToString: () => "tail" },
    ];
    const buffer = { length: lines.length, getLine: (y: number) => lines[y] };
    expect(readRows(buffer, -3, 9)).toEqual([row("top"), row("tail", true)]);
  });
});
