/** Markdown to HTML for the Reader's preview; `marked` and `dompurify` are pinned because their output is what this face shows.
 * Trap: any file in the tree is untrusted and the phone page has no CSP, so DOMPurify's allowlist is the only wall. */

import type { DOMPurify } from "dompurify";
import { Marked, type Tokens } from "marked";

export type Purifier = DOMPurify;

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

const ALERTS: Record<string, string> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

const ALERT_MARK = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i;

const marked = new Marked({
  gfm: true,
  // READMEs are hard-wrapped at 80 columns; breaking on each newline would shred paragraphs on a phone.
  breaks: false,
  renderer: {
    link(token: Tokens.Link): string {
      const words = this.parser.parseInline(token.tokens);
      if (!isLiveHref(token.href)) return words;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<a href="${escapeHtml(token.href.trim())}"${title}>${words}</a>`;
    },
    image(token: Tokens.Image): string {
      const words = escapeHtml(token.text || "image");
      if (!/^https?:\/\//i.test(token.href.trim())) return words;
      return `<img src="${escapeHtml(token.href.trim())}" alt="${words}">`;
    },
    blockquote(token: Tokens.Blockquote): string {
      const body = this.parser.parse(token.tokens);
      const mark = ALERT_MARK.exec(body);
      if (!mark) return `<blockquote>\n${body}</blockquote>\n`;
      const kind = mark[1].toUpperCase();
      const rest = `<p>${body.slice(mark[0].length)}`.replace(/^<p><\/p>\n?/, "");
      return `<div class="baud-phone-md-alert baud-phone-md-alert-${kind.toLowerCase()}"><p class="baud-phone-md-alert-title">${ALERTS[kind]}</p>\n${rest}</div>\n`;
    },
  },
});

const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "em", "strong", "del", "s", "code", "pre",
  "blockquote", "ul", "ol", "li", "input", "table", "thead", "tbody", "tr", "th", "td",
  "a", "img", "details", "summary", "div", "span", "sup", "sub", "kbd",
];

const ALLOWED_ATTR = [
  "href", "title", "src", "alt", "width", "height", "class", "open", "align",
  "start", "type", "checked", "disabled",
];

// The renderer's own classes only: a file's class could otherwise dress itself as the app's chrome.
const OWN_CLASS = /^(language-[\w+#.-]+|baud-phone-md-[\w-]+)$/;

const readied = new WeakSet<Purifier>();

// Hooks live on the purifier, so each is added once; a second add would run twice per node.
function ready(purify: Purifier): void {
  if (readied.has(purify)) return;
  readied.add(purify);
  purify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName === "class" && !data.attrValue.split(/\s+/).filter(Boolean).every((name) => OWN_CLASS.test(name))) {
      data.keepAttr = false;
    }
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    // A relative address would resolve against the host API, not the file's folder.
    if (node.hasAttribute("href") && !isLiveHref(node.getAttribute("href") ?? "")) node.removeAttribute("href");
    if (node.hasAttribute("src") && !/^https?:\/\//i.test((node.getAttribute("src") ?? "").trim())) node.removeAttribute("src");
    if (node.tagName === "IMG") node.setAttribute("loading", "lazy");
    // A link that left the page would replace the phone app; a box in a file is never the operator's to tick.
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (node.tagName === "INPUT") node.setAttribute("disabled", "");
  });
}

/** The preview's HTML: marked's render, then DOMPurify's allowlist over all of it, raw HTML in the file included. */
export function markdownHtml(text: string, purify: Purifier): string {
  ready(purify);
  return purify.sanitize(marked.parse(text, { async: false }), { ALLOWED_TAGS, ALLOWED_ATTR });
}
