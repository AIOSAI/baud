/** Markdown to HTML for the Reader; `marked` is pinned because its output is what this face shows.
 * Trap: an agent's README is untrusted, so raw HTML is escaped and only absolute http(s)/mailto links are live. */

import { Marked, type Tokens } from "marked";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isLiveHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

export function isMarkdownRef(ref: string): boolean {
  return /\.md$/i.test(ref);
}

const marked = new Marked({
  gfm: true,
  // READMEs are hard-wrapped at 80 columns; breaking on each newline would shred paragraphs on a phone.
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

export function markdownHtml(text: string): string {
  return marked.parse(text, { async: false });
}
