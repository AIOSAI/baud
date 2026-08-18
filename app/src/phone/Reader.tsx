/**
 * The reading room, phone-shaped (FPLAN-0413 phase 3b).
 *
 * Patrick's first review of the face: "it shows all agents but zero function."
 * He was right, and the cause was mine - the card's figures ARE doors on the
 * desktop, and I had wired every one of them to a handler that threw. Reads are
 * not verbs; refusing them was over-application of `readOnly`.
 *
 * So: one full-height sheet that shows a file or a diff. No editor, no save, no
 * verb - the doctrine holds because reading was always allowed.
 *
 * PATHS ARE NAMES HERE. @api's fence takes a branch and a file name and has no
 * path parameter to abuse, so this sheet is opened with `<branch>/<relative>`
 * and never the absolute path the desktop passes around. The transport refuses
 * an absolute path outright rather than guessing at it.
 */

import { type ReactNode, useEffect, useState } from "react";

import { gitDiffText, readFileText } from "../host";
import { HostError } from "../host/transport.http";

export interface ReadTarget {
  /** `<branch>/<file>` for a file, or just the branch name for a diff. */
  ref: string;
  /** What the header calls it. */
  title: string;
  kind: "file" | "diff";
  /**
   * WHICH PROJECT the branch lives in - browsing is free since 2026-08-16.
   *
   * Absent means the seat, which is what every read on this face meant before
   * the ruling. It matters most when it is WRONG rather than missing: eleven
   * projects share a naming convention, so a read aimed at a foreign agent and
   * silently resolved under the seat does not fail - it finds a different
   * agent's file and shows it as this one's. Naming the project is what makes
   * the cross-project read a fact rather than a coincidence.
   */
  project?: string;
}

interface ReaderProps {
  target: ReadTarget;
  /**
   * AN OPTIONAL DESIGNED RENDER for the text this reader read - and the
   * reader knows nothing about what it draws.
   *
   * One file in the fleet is a document rather than a file: @spawn's birth
   * certificate. Rather than teach this reader about certificates, the caller
   * hands in a renderer and this reader asks it. Returning null is the
   * renderer DECLINING - the file did not parse, or parsed into something that
   * is not the document it draws - and the raw text below is then the render,
   * exactly as it is for every other file on this face.
   *
   * ABSENT ON EVERY OTHER OPEN, which is what keeps this addition free: with
   * no renderer there is no branch, and the `<pre>` is reached the same way it
   * always was.
   */
  render?: (content: string) => ReactNode | null;
  onClose: () => void;
}

export default function Reader({ target, render, onClose }: ReaderProps) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setText(null);
    setError(null);
    const read =
      target.kind === "diff"
        ? gitDiffText(target.ref, target.project)
        : readFileText(target.ref, target.project);
    read
      .then((got) => {
        if (!mounted) return;
        setText(got.content);
        setTruncated(got.truncated);
      })
      .catch((cause) => {
        if (!mounted) return;
        // @api's sentence, verbatim - "Unknown branch: 'baud'" is a far better
        // thing to read on a phone than "could not load".
        setError(cause instanceof HostError ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
    // The project is a dependency because it CHANGES THE ANSWER: the same ref
    // read under two projects is two different files.
  }, [target.ref, target.kind, target.project]);

  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ back
        </button>
        <span className="baud-phone-reader-title">{target.title}</span>
      </header>

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && text === null ? <p className="baud-phone-empty">reading…</p> : null}
      {truncated ? <p className="baud-phone-truncated">truncated by the server — this is the head of the file</p> : null}

      {/* The designed render first, the file itself if it declined. `?? null`
          rather than a ternary on `render`: a renderer that says no is the
          same case as no renderer at all, and both land on the raw text. */}
      {text !== null ? (render?.(text) ?? <pre className="baud-phone-text">{text}</pre>) : null}
    </section>
  );
}
