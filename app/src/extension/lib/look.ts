/** Looking at, pure over a DOM node: what an element says, and the page it is on. */

export const CTX_TEXT = 300;
export const CTX_SEL = 600;

export function squash(text: unknown, cap = CTX_TEXT): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > cap ? t.slice(0, cap - 1) + "…" : t;
}

/** jsdom has no innerText; the page does, and it skips hidden text. */
const textOf = (n: Element) => (n as HTMLElement).innerText ?? n.textContent ?? "";

/** The page id: the address without query or hash, so a token in a query never leaves the tab. */
export const pageId = (href: string) => href.split(/[?#]/)[0];

export const pageTitle = (doc: Document, host: string) => squash(doc.title || host, 120);

/** Heading, then link, then image alt, then list item or cell, then the node's own text. */
export function what(node: Element | null | undefined, skip?: Element): string {
  const doc = node?.ownerDocument;
  if (!node || !doc || node === skip || node === doc.body || node === doc.documentElement || !node.closest) return "";
  const head = node.closest("h1, h2, h3, h4, h5, h6");
  if (head) return squash(textOf(head));
  const link = node.closest("a[href]") as HTMLAnchorElement | null;
  if (link) return squash(`${squash(textOf(link)) || link.getAttribute("aria-label") || "a link"} (${link.href})`);
  if (node.tagName === "IMG") {
    const alt = (node as HTMLImageElement).alt;
    return alt ? squash(`image: ${alt}`) : "";
  }
  return squash(textOf(node.closest("li, td, th") ?? node));
}

export const selectionText = (raw: string) => {
  const t = squash(raw, CTX_SEL);
  return t ? `Selected: "${t}"` : "";
};
