import { useEffect, useRef, useState } from "react";
import { gitDiffText } from "../host";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightSpecialChars,
  lineNumbers,
} from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";


/**
 * The changes tab: a branch's uncommitted diff, read-only. A diff goes stale as the agent works,
 * so it refetches each time the tab comes to the front.
 */

/** Same chrome blend as FileView - the panes should be indistinguishable. */
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

export default function DiffView({ dir, active }: { dir: string; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Hidden panes stay mounted (the tab model never unmounts); skipping the
    // load while hidden is what makes each return visit fetch fresh.
    if (!active) return;
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let view: EditorView | null = null;

    gitDiffText(dir)
      .then(async (diff) => {
        if (disposed) return;

        if (diff.content === "") {
          setNotice("working tree clean - nothing uncommitted");
          return;
        }

        const description = LanguageDescription.matchFilename(languages, "changes.diff");
        const language = description ? await description.load() : [];
        if (disposed) return;

        setNotice(diff.truncated ? "truncated - the viewer caps at 512 KB" : null);
        view = new EditorView({
          state: EditorState.create({
            doc: diff.content,
            extensions: [
              lineNumbers(),
              highlightSpecialChars(),
              drawSelection(),
              EditorView.lineWrapping,
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              oneDark,
              baudChrome,
              language,
            ],
          }),
          parent: host,
        });
      })
      .catch((err) => {
        if (!disposed) setNotice(describe(err));
      });

    return () => {
      disposed = true;
      view?.destroy();
    };
  }, [dir, active]);

  return (
    <div className="baud-view">
      {notice ? <div className="baud-view-notice">{notice}</div> : null}
      <div className="baud-view-host" ref={hostRef} />
    </div>
  );
}
