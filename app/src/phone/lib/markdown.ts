/**
 * Markdown, drawn rather than printed (DPLAN-0414 A#23).
 *
 * The card's name opens the branch's README, and a README is a document its
 * own agents are told is the source of truth - read on the phone as raw
 * markdown it was a wall of `#`, `**` and monospace tables. This turns the text
 * into HTML the Reader can draw through its `render` door, the same door the
 * birth certificate uses.
 *
 * WHY `marked`, and pinned. Nothing in this app rendered markdown before (the
 * desktop has no renderer to share), so the smallest dependency that does
 * headings, lists, code fences, tables and links came in: `marked` 18.1.1, no
 * dependencies of its own, about 47 KB minified and 14 KB gzipped. Pinned to the
 * exact version because a renderer's output is part of what this face shows.
 *
 * NO RAW HTML PASSES THROUGH. A README is written by an agent, and an agent's
 * file is not a thing this face trusts to run code in the operator's browser.
 * So every HTML token, block or inline, is drawn as its own escaped text: the
 * operator sees `<img onerror=...>` as characters, which is what it is. Text,
 * code and titles are escaped by `marked` itself.
 *
 * LINKS: only absolute `http(s):` and `mailto:` addresses are live, and they
 * open in a new tab so the reader underneath survives. A relative link
 * (`docs/phone.md`, `#install`) names a place in the branch, and this face has
 * no door from a rendered link into the files lane yet, so it is drawn as its
 * words rather than as a link that would open a dead page on the host. Every
 * other scheme (`javascript:`, `data:`) is the same words, never a link.
 * Images are not fetched: they are drawn as a link to the picture when the
 * address is one a link may carry, else as their alt text.
 */

import { Marked, type Tokens } from "marked";

/** HTML-escape a string for text and attribute positions alike. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** May this address be a live link? Absolute web and mail addresses only. */
export function isLiveHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

/** Does this reference name a markdown file? `.md`, any case. */
export function isMarkdownRef(ref: string): boolean {
  return /\.md$/i.test(ref);
}

const marked = new Marked({
  gfm: true,
  // A single newline inside a paragraph stays a space, as on GitHub: READMEs
  // in this fleet are hard-wrapped at 80 columns and breaking on each would
  // turn every paragraph into a column of short lines on a phone.
  breaks: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    link(token: Tokens.Link): string {
      const words = this.parser.parseInline(token.tokens);
      if (!isLiveHref(token.href)) return words;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<a href="${escapeHtml(token.href.trim())}"${title} target="_blank" rel="noopener noreferrer">${words}</a>`;
    },
    image(token: Tokens.Image): string {
      const words = escapeHtml(token.text || "image");
      if (!isLiveHref(token.href)) return words;
      return `<a href="${escapeHtml(token.href.trim())}" target="_blank" rel="noopener noreferrer">[image: ${words}]</a>`;
    },
  },
});

/** The markdown as HTML, with raw HTML escaped and only safe links live. */
export function markdownHtml(text: string): string {
  return marked.parse(text, { async: false });
}
