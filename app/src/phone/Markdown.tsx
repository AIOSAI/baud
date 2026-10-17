/**
 * The Reader's markdown render for `.md` refs.
 * The `innerHTML` is safe only because lib/markdown.ts escapes every raw HTML token; see there.
 */

import type { ReactNode } from "react";

import { markdownHtml } from "./lib/markdown";

export function renderMarkdown(content: string): ReactNode | null {
  return <div className="baud-phone-md" dangerouslySetInnerHTML={{ __html: markdownHtml(content) }} />;
}
