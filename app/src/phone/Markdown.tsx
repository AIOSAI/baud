/** The Reader's `.md` preview; its `innerHTML` is safe only because lib/markdown.ts runs every render through DOMPurify. */

import DOMPurify from "dompurify";
import type { ReactNode } from "react";

import { markdownHtml } from "./lib/markdown";

export function renderMarkdown(content: string): ReactNode {
  return <div className="baud-phone-md" dangerouslySetInnerHTML={{ __html: markdownHtml(content, DOMPurify) }} />;
}
