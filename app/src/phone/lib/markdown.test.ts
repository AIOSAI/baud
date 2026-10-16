import { describe, expect, it } from "vitest";

import { escapeHtml, isLiveHref, isMarkdownRef, markdownHtml } from "./markdown";

describe("markdownHtml", () => {
  it("draws a heading", () => {
    expect(markdownHtml("# BAUD")).toBe("<h1>BAUD</h1>\n");
  });

  it("draws a list", () => {
    expect(markdownHtml("- one\n- two")).toBe("<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n");
  });

  it("draws a code fence with its text escaped", () => {
    expect(markdownHtml("```sh\necho <x>\n```")).toBe(
      '<pre><code class="language-sh">echo &lt;x&gt;\n</code></pre>\n',
    );
  });

  it("draws a table", () => {
    const html = markdownHtml("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>2</td>");
  });

  it("opens an http link in a new tab", () => {
    expect(markdownHtml("[site](https://example.com/a?b=1&c=2)")).toBe(
      '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site</a></p>\n',
    );
  });

  it("carries a link's title, escaped", () => {
    expect(markdownHtml('[x](https://example.com "a \\"q\\"")')).toContain('title="a &quot;q&quot;"');
  });

  it("draws a relative link as its words only", () => {
    expect(markdownHtml("[docs](docs/phone.md)")).toBe("<p>docs</p>\n");
  });

  it("never makes a javascript: link live", () => {
    expect(markdownHtml("[x](javascript:alert(1))")).toBe("<p>x</p>\n");
  });

  it("escapes a raw HTML block instead of passing it through", () => {
    expect(markdownHtml('<div onclick="x()">hi</div>')).toBe("&lt;div onclick=&quot;x()&quot;&gt;hi&lt;/div&gt;");
  });

  it("escapes inline raw HTML", () => {
    expect(markdownHtml("a <img src=x onerror=alert(1)> b")).toBe(
      "<p>a &lt;img src=x onerror=alert(1)&gt; b</p>\n",
    );
  });

  it("draws an image as a link to it, never as an image", () => {
    expect(markdownHtml("![logo](https://example.com/l.png)")).toBe(
      '<p><a href="https://example.com/l.png" target="_blank" rel="noopener noreferrer">[image: logo]</a></p>\n',
    );
  });

  it("draws a relative image as its alt text", () => {
    expect(markdownHtml("![logo](img/l.png)")).toBe("<p>logo</p>\n");
  });

  it("keeps a hard-wrapped paragraph one paragraph", () => {
    expect(markdownHtml("one\ntwo")).toBe("<p>one\ntwo</p>\n");
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
