/** The phone's reading room: a file or diff, opened by name (`<branch>/<relative>`), never an absolute path. */

import { type ReactNode, useEffect, useState } from "react";

import { gitDiffText, readFileText } from "../host";
import { HostError } from "../host/transport.http";
import { NO_FLOOR, copyShown, copyThrough, machinePath, underRoot } from "./lib/copyPath";

export interface ReadTarget {
  /** `<branch>/<file>` for a file, or just the branch name for a diff. */
  ref: string;
  /** What `ref`'s first word is (`home`, `project`, `aipass`, absent = branch); without it the read lands elsewhere. */
  root?: string;
  title: string;
  kind: "file" | "diff";
  /** Absent means the seat. Projects share branch names, so a misaimed read finds another agent's file silently. */
  project?: string;
}

interface ReaderProps {
  target: ReadTarget;
  /** A caller's designed render; null is the renderer declining, and the raw text is then the render. */
  render?: (content: string) => ReactNode | null;
  /** A second face of the text behind a header switch; raw stays the default. */
  preview?: (content: string) => ReactNode;
  backLabel?: string;
  onClose: () => void;
}

export default function Reader({ target, render, preview, backLabel = "back", onClose }: ReaderProps) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [floor, setFloor] = useState("");
  const [copied, setCopied] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [byHand, setByHand] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let mounted = true;
    setText(null);
    setPreviewing(false);
    setError(null);
    setFloor("");
    setCopied(false);
    setSaid(null);
    setByHand(null);
    const read =
      target.kind === "diff"
        ? gitDiffText(target.ref, target.project)
        : readFileText(target.ref, target.project, target.root);
    read
      .then((got) => {
        if (!mounted) return;
        setText(got.content);
        setTruncated(got.truncated);
        setFloor(got.floor ?? "");
      })
      .catch((cause) => {
        if (!mounted) return;
        // @api's sentence, unreworded; the transport ends it with a `ref` to find in the host's log.
        setError(cause instanceof HostError ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
    // project and root change the answer: the same ref under two floors is two files.
  }, [target.ref, target.kind, target.project, target.root]);

  const machine = machinePath(floor, underRoot(target.ref));

  // Only a confirmed copy lights "copied": the legacy lane (plain http) can say yes and land nothing.
  // `copyThrough` reaches `execCommand` before its first await, so the copy still runs inside the tap.
  const copy = async () => {
    setSaid(null);
    setCopied(false);
    setByHand(null);
    if (!machine) {
      setSaid(NO_FLOOR);
      return;
    }
    const shown = copyShown(await copyThrough(machine), machine);
    setCopied(shown.copied);
    setSaid(shown.note);
    setByHand(shown.byHand);
  };

  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ {backLabel}
        </button>
        <span className="baud-phone-reader-title">{target.title}</span>
        {/* No button for a diff (no path names it), nor before the text: the floor arrives with the read. */}
        {target.kind === "file" && text !== null ? (
          <button
            type="button"
            className={`baud-phone-copyhead ${copied ? "baud-phone-copy-done" : ""}`}
            onClick={copy}
          >
            {copied ? "copied" : "copy path"}
          </button>
        ) : null}
        {preview && text ? (
          <button
            type="button"
            className={`baud-phone-copyhead ${previewing ? "baud-phone-copy-done" : ""}`}
            aria-pressed={previewing}
            onClick={() => setPreviewing((on) => !on)}
          >
            {previewing ? "raw" : "preview"}
          </button>
        ) : null}
      </header>

      {said ? <p className="baud-phone-said">{said}</p> : null}
      {byHand ? <CopyByHand text={byHand} /> : null}
      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && text === null ? <p className="baud-phone-empty">reading…</p> : null}
      {truncated ? <p className="baud-phone-truncated">truncated by the server — this is the head of the file</p> : null}

      {/* An empty `<pre>` reads as a screen that never loaded, so a zero-byte file says so. */}
      {text === "" ? (
        <p className="baud-phone-empty">{target.kind === "diff" ? "this diff is empty" : "this file is empty"}</p>
      ) : null}
      {text ? (
        previewing && preview ? preview(text) : (render?.(text) ?? <pre className="baud-phone-text">{text}</pre>)
      ) : null}
    </section>
  );
}

export function CopyByHand({ text }: { text: string }) {
  return (
    <textarea
      className="baud-phone-copy-field"
      readOnly
      rows={2}
      value={text}
      aria-label="the path, to copy by hand"
      onFocus={(event) => event.currentTarget.select()}
    />
  );
}
