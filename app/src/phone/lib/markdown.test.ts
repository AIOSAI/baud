// @vitest-environment jsdom
import DOMPurify from "dompurify";
import { describe, expect, it } from "vitest";

import { escapeHtml, isLiveHref, isMarkdownRef, markdownHtml } from "./markdown";

const md = (text: string) => markdownHtml(text, DOMPurify);

describe("markdownHtml", () => {
  it("draws a heading", () => {
    expect(md("# BAUD")).toBe("<h1>BAUD</h1>\n");
  });

  it("draws a list", () => {
    expect(md("- one\n- two")).toBe("<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n");
  });

  it("draws a code fence with its text escaped and its language class kept", () => {
    expect(md("```sh\necho <x>\n```")).toBe('<pre><code class="language-sh">echo &lt;x&gt;\n</code></pre>\n');
  });

  it("draws a table", () => {
    const html = md("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>2</td>");
  });

  it("opens an http link in a new tab", () => {
    expect(md("[site](https://example.com/a?b=1&c=2)")).toBe(
      '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site</a></p>\n',
    );
  });

  it("carries a link's title", () => {
    expect(md('[x](https://example.com "a \\"q\\"")')).toContain('title="a &quot;q&quot;"');
  });

  it("draws a relative link as its words only", () => {
    expect(md("[docs](docs/phone.md)")).toBe("<p>docs</p>\n");
  });

  it("never makes a javascript: link live", () => {
    expect(md("[x](javascript:alert(1))")).toBe("<p>x</p>\n");
  });

  it("strips script and event handlers from raw HTML in the file", () => {
    const html = md('<div onclick="x()">hi</div>\n\na <img src="https://e.com/i.png" onerror="alert(1)"> b\n\n<script>alert(2)</script>');
    expect(html).not.toMatch(/onclick|onerror|<script|alert\(2\)/);
    expect(html).toContain("<div>hi</div>");
    expect(html).toContain('<img src="https://e.com/i.png" loading="lazy">');
  });

  it("strips a javascript: address, an iframe and a style from raw HTML", () => {
    const html = md('<a href="javascript:alert(1)">j</a> <iframe src="https://e.com"></iframe> <span style="color:red">s</span>');
    expect(html).not.toMatch(/javascript|iframe|style/);
    expect(html).toContain("<a>j</a>");
    expect(html).toContain("<span>s</span>");
  });

  it("sends a raw HTML link to a new tab", () => {
    expect(md('<a href="https://e.com" target="_self">e</a>')).toContain(
      '<a href="https://e.com" target="_blank" rel="noopener noreferrer">e</a>',
    );
  });

  it("drops a class the renderer did not write", () => {
    expect(md('<div class="baud-phone-error language-x">x</div>')).toBe("<div>x</div>");
  });

  it("keeps a details block open and closed", () => {
    const html = md("<details open>\n<summary>More</summary>\n\nInside **here**.\n\n</details>");
    expect(html).toContain('<details open="">');
    expect(html).toContain("<summary>More</summary>");
    expect(html).toContain("<strong>here</strong>");
  });

  it("draws an absolute image inline", () => {
    expect(md("![logo](https://example.com/l.png)")).toBe(
      '<p><img src="https://example.com/l.png" alt="logo" loading="lazy"></p>\n',
    );
  });

  it("draws a relative image as its alt text", () => {
    expect(md("![logo](img/l.png)")).toBe("<p>logo</p>\n");
  });

  it("draws a GitHub alert under its title", () => {
    expect(md("> [!WARNING]\n> Mind the gap.")).toBe(
      '<div class="baud-phone-md-alert baud-phone-md-alert-warning"><p class="baud-phone-md-alert-title">Warning</p>\n<p>Mind the gap.</p>\n</div>\n',
    );
  });

  it("keeps a plain quote a quote", () => {
    expect(md("> just said")).toBe("<blockquote>\n<p>just said</p>\n</blockquote>\n");
  });

  it("leaves a box in raw HTML unclickable", () => {
    expect(md('<input type="checkbox">')).toMatch(/<input[^>]*disabled/);
  });

  it("drops a relative address from raw HTML", () => {
    expect(md('<a href="docs/a.md">a</a> <img src="img/l.png" alt="l">')).toBe('<p><a>a</a> <img alt="l" loading="lazy"></p>\n');
  });

  it("keeps a raw image's size and a paragraph's alignment", () => {
    expect(md('<p align="center"><img src="https://e.com/l.png" width="200"></p>')).toBe(
      '<p align="center"><img src="https://e.com/l.png" width="200" loading="lazy"></p>',
    );
  });

  it("keeps a hard-wrapped paragraph one paragraph", () => {
    expect(md("one\ntwo")).toBe("<p>one\ntwo</p>\n");
  });
});

describe("isLiveHref", () => {
  it("allows http, https and mailto", () => {
    expect(isLiveHref("http://a")).toBe(true);
    expect(isLiveHref("HTTPS://a")).toBe(true);
    expect(isLiveHref("mailto:a@b")).toBe(true);
  });

  it("refuses relative, anchor, javascript and data addresses", () => {
    expect(isLiveHref("docs/a.md")).toBe(false);
    expect(isLiveHref("#install")).toBe(false);
    expect(isLiveHref("javascript:x")).toBe(false);
    expect(isLiveHref("data:text/html,x")).toBe(false);
  });

  it("refuses a javascript: address that carries an http address inside it", () => {
    expect(isLiveHref("javascript:fetch('https://x')")).toBe(false);
  });
});

describe("isMarkdownRef", () => {
  it("matches .md in any case", () => {
    expect(isMarkdownRef("baud/README.md")).toBe(true);
    expect(isMarkdownRef("baud/NOTES.MD")).toBe(true);
  });

  it("does not match other files", () => {
    expect(isMarkdownRef("baud/README.md.bak")).toBe(false);
    expect(isMarkdownRef("baud/.trinity/local.json")).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});
