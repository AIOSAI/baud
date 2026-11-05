// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { pageId, selectionText, squash, what } from "./look";

beforeEach(() => {
  document.body.innerHTML = `
    <h2 id="h">A <b id="hb">heading</b></h2>
    <a id="a" href="https://example.com/x?y=1">the link</a>
    <a id="empty" href="/z" aria-label="labelled"></a>
    <img id="img" alt="a cat" />
    <img id="noalt" />
    <ul><li id="li">one <i id="lii">item</i></li></ul>
    <table><tr><td id="td">cell text</td></tr></table>
    <p id="p">   plain
      paragraph   </p>
    <div id="host">orb</div>`;
});
const $ = (id: string) => document.getElementById(id)!;

describe("what", () => {
  it("reads headings, links, alt text, list items and cells", () => {
    expect(what($("hb"))).toBe("A heading");
    expect(what($("a"))).toBe("the link (https://example.com/x?y=1)");
    expect(what($("empty"))).toBe(`labelled (${(document.getElementById("empty") as HTMLAnchorElement).href})`);
    expect(what($("img"))).toBe("image: a cat");
    expect(what($("noalt"))).toBe("");
    expect(what($("lii"))).toBe("one item");
    expect(what($("td"))).toBe("cell text");
    expect(what($("p"))).toBe("plain paragraph");
  });

  it("says nothing for the page itself or the overlay", () => {
    expect(what(document.body)).toBe("");
    expect(what(document.documentElement)).toBe("");
    expect(what(null)).toBe("");
    expect(what($("host"), $("host"))).toBe("");
  });
});

describe("page id and text", () => {
  it("strips the query and hash", () => {
    expect(pageId("https://a.com/p/q?token=secret#frag")).toBe("https://a.com/p/q");
    expect(pageId("https://a.com/p#x")).toBe("https://a.com/p");
  });

  it("squashes and caps", () => {
    expect(squash("a\n\n b", 10)).toBe("a b");
    expect(squash("abcdef", 4)).toBe("abc…");
    expect(selectionText("  ")).toBe("");
    expect(selectionText("hi there")).toBe('Selected: "hi there"');
  });
});
