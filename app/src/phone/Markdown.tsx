/**
 * The Reader's markdown render (DPLAN-0414 A#23) - handed to `Reader`'s
 * `render` door for `.md` refs, the same door the birth certificate uses.
 *
 * The HTML comes from `lib/markdown.ts`, which escapes every raw HTML token and
 * makes only absolute web and mail links live, so the one `innerHTML` on this
 * face carries no markup an agent's file wrote. That file says why in full.
 *
 * It never declines: any text is valid markdown, and plain prose renders as
 * paragraphs - which is still easier to read on a phone than a `<pre>`.
 */

import type { ReactNode } from "react";

import { markdownHtml } from "./lib/markdown";

export function renderMarkdown(content: string): ReactNode | null {
  return <div className="baud-phone-md" dangerouslySetInnerHTML={{ __html: markdownHtml(content) }} />;
}
