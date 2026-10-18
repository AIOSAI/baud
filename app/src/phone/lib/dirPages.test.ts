import { describe, expect, it } from "vitest";

import type { DirEntryInfo, DirWindow } from "../../types";
import { countLine, firstPage, moreLabel, nextOffset, withPage } from "./dirPages";

const files = (from: number, to: number): DirEntryInfo[] =>
  Array.from({ length: to - from }, (_, i) => ({ name: `f${from + i}`, path: `d/f${from + i}`, is_dir: false }));

const page = (entries: DirEntryInfo[], truncated: boolean, total?: number): DirWindow => ({ entries, truncated, total });

describe("a long level on a host that pages", () => {
  it("counts what is shown against the level and asks for the next page where the first ended", () => {
    const listing = firstPage(page(files(0, 400), true, 1059));
    expect(countLine(listing)).toBe("400 of 1059 shown");
    expect(nextOffset(listing)).toBe(400);
    expect(moreLabel(listing)).toBe("show more (659 left)");
  });

  it("appends pages until the level is whole, then drops the count and the button", () => {
    let listing = firstPage(page(files(0, 400), true, 1059));
    listing = withPage(listing, page(files(400, 800), true, 1059));
    expect(countLine(listing)).toBe("800 of 1059 shown");
    expect(nextOffset(listing)).toBe(800);
    listing = withPage(listing, page(files(800, 1059), false, 1059));
    expect(listing.entries).toHaveLength(1059);
    expect(listing.entries[1058].path).toBe("d/f1058");
    expect(countLine(listing)).toBeNull();
    expect(nextOffset(listing)).toBeNull();
  });

  it("shows an entry once when the folder shifted between pages", () => {
    const listing = withPage(firstPage(page(files(0, 3), true, 6)), page(files(2, 5), true, 6));
    expect(listing.entries.map((entry) => entry.name)).toEqual(["f0", "f1", "f2", "f3", "f4"]);
    expect(nextOffset(listing)).toBe(5);
  });

  it("counts against the latest page's total when the folder grew between pages", () => {
    const listing = withPage(firstPage(page(files(0, 400), true, 1059)), page(files(400, 800), true, 1061));
    expect(countLine(listing)).toBe("800 of 1061 shown");
  });

  it("stops asking when a page brings nothing new, so a shrunken folder cannot loop", () => {
    const listing = withPage(firstPage(page(files(0, 3), true, 9)), page(files(0, 3), true, 9));
    expect(nextOffset(listing)).toBeNull();
  });
});

describe("a long level on an older host", () => {
  it("says the first page is all it lists and offers no button", () => {
    const listing = firstPage(page(files(0, 400), true));
    expect(countLine(listing)).toBe("the first 400 shown - this host does not list further");
    expect(nextOffset(listing)).toBeNull();
  });
});

describe("a short level", () => {
  it("shows no count line", () => {
    expect(countLine(firstPage(page(files(0, 5), false, 5)))).toBeNull();
    expect(countLine(firstPage(page(files(0, 5), false)))).toBeNull();
  });
});
