import { useEffect, useRef, useState } from "react";
import { readFileText } from "../host";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  lineNumbers,
} from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";

import { isMarkdownRef } from "../phone/lib/markdown";
import { renderMarkdown } from "../phone/Markdown";

/**
 * The read-only pane behind a file tab. Editing is off by design: enabling it needs its own save command, not two flags flipped.
 */

/** Blend one-dark's chrome into BAUD's panels; theme.css stays the palette. */
const baudChrome = EditorView.theme({
  "&": {
    backgroundColor: "var(--baud-bg-panel)",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-gutters": {
    backgroundColor: "var(--baud-bg-panel)",
    borderRight: "1px solid var(--baud-line)",
  },
  ".cm-scroller": { fontFamily: "var(--baud-mono)" },
});

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export default function FileView({ path, line }: { path: string; line?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The text again, for the phone's markdown preview; the editor keeps its own copy.
  const [content, setContent] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Guards the async gap between mount, file load, and language load.
    let disposed = false;
    let view: EditorView | null = null;

    readFileText(path)
      .then(async (file) => {
        if (disposed) return;
        setContent(file.content);

        const name = path.split("/").pop() ?? path;
        const description = LanguageDescription.matchFilename(languages, name);
        const language = description ? await description.load() : [];
        if (disposed) return;

        view = new EditorView({
          state: EditorState.create({
            doc: file.content,
            extensions: [
              lineNumbers(),
              highlightSpecialChars(),
              drawSelection(),
              // The fleet's JSON dashboards live on very long single lines.
              EditorView.lineWrapping,
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              // The active-line wash only exists when a terminal link asked
              // for a specific line - plain file views stay uniform.
              line ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
              oneDark,
              baudChrome,
              language,
            ],
          }),
          parent: host,
        });

        // Clamped: terminal output can cite a line the file no longer has.
        if (line && line > 0) {
          const target = view.state.doc.line(Math.min(line, view.state.doc.lines));
          view.dispatch({
            selection: { anchor: target.from },
            effects: EditorView.scrollIntoView(target.from, { y: "center" }),
          });
        }

        if (file.truncated) setNotice("truncated - the viewer caps at 512 KB");
      })
      .catch((err) => {
        if (!disposed) setNotice(describe(err));
      });

    return () => {
      disposed = true;
      view?.destroy();
    };
  }, [path, line]);

  return (
    <div className="baud-view">
      {isMarkdownRef(path) && content !== null ? (
        <div className="baud-view-bar">
          <button
            type="button"
            className={`baud-phone-copyhead ${previewing ? "baud-phone-copy-done" : ""}`}
            aria-pressed={previewing}
            onClick={() => setPreviewing((on) => !on)}
          >
            {previewing ? "raw" : "preview"}
          </button>
        </div>
      ) : null}
      {notice ? <div className="baud-view-notice">{notice}</div> : null}
      {/* The editor stays mounted behind the preview: rebuilding it would lose the cited line. */}
      <div className="baud-view-host" ref={hostRef} hidden={previewing} />
      {previewing && content ? <div className="baud-view-md">{renderMarkdown(content)}</div> : null}
    </div>
  );
}
