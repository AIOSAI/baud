import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

import type { FileText } from "../types";

/**
 * The read-only reading pane behind a file tab. CodeMirror deliberately runs
 * with editing OFF (`readOnly` + non-editable): BAUD reads the fleet, it does
 * not write it. If editing ever arrives it will be its own explicit feature
 * with its own save command - flipping these two flags is the easy part.
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Guards the async gap between mount, file load, and language load.
    let disposed = false;
    let view: EditorView | null = null;

    invoke<FileText>("read_file_text", { path })
      .then(async (file) => {
        if (disposed) return;

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
              // Wrap long lines - this is a reading pane, and the fleet's
              // JSON dashboards live on very long single lines.
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

        // A `path:123` link lands ON its line: cursor there, scrolled to
        // centre. Clamped - output can cite a line the file no longer has.
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
      {notice ? <div className="baud-view-notice">{notice}</div> : null}
      <div className="baud-view-host" ref={hostRef} />
    </div>
  );
}
