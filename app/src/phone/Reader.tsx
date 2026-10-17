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
import { NO_FLOOR, copyShown, copyThrough, machinePath, underRoot } from "./lib/copyPath";

export interface ReadTarget {
  /** `<branch>/<file>` for a file, or just the branch name for a diff. */
  ref: string;
  /**
   * WHICH KIND OF WORD the first component of `ref` is (FPLAN-0443): `home`,
   * `project`, `aipass`, or `branch`. Absent is the branch meaning every read
   * on this face had before the roots roster existed, and it travels as an
   * absent key rather than a spelled-out default.
   *
   * It rides the target because a file opened out of the home directory is
   * still a file, read by this same reader, through this same lane - the only
   * thing that differs is which floor the server resolves it against, and that
   * fact has to travel WITH the reference or the read lands somewhere else.
   */
  root?: string;
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
   * A SECOND CALLER since DPLAN-0414 (A#23): a `.md` ref is handed
   * `renderMarkdown`, so a README reads as a document rather than as `#` and
   * `**`. Same door, same rule - the reader still knows nothing about what it
   * draws, and the caller decides which files get a renderer.
   *
   * ABSENT ON EVERY OTHER OPEN, which is what keeps this addition free: with
   * no renderer there is no branch, and the `<pre>` is reached the same way it
   * always was.
   */
  render?: (content: string) => ReactNode | null;
  /**
   * The word after `‹`: where back lands (DPLAN-0414 wave 6, item 10 - every
   * `‹` names its destination). The caller knows and this reader does not:
   * `card` for the card's README, `folder` for a file tab opened from a
   * browse. Absent is `back`, for the callers whose back is a level of their
   * own (the git app's file view returns to its changes list).
   */
  backLabel?: string;
  onClose: () => void;
}

export default function Reader({ target, render, backLabel = "back", onClose }: ReaderProps) {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Where this file stands on the machine - see `copyPath`. "" is a server
   *  that did not say, and the copy refuses on it. */
  const [floor, setFloor] = useState("");
  /** This file's path is on the clipboard. No timer: the clipboard has none. */
  const [copied, setCopied] = useState(false);
  /** Why the copy did not happen, or why it may not have. */
  const [said, setSaid] = useState<string | null>(null);
  /** The path, held out for a long-press Copy when no lane confirmed the copy
   *  (DPLAN-0414 A#21). Null when the tick said it all. */
  const [byHand, setByHand] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setText(null);
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
        // @api's sentence, unreworded - "Unknown branch: 'baud'" is a far
        // better thing to read on a phone than "could not load". A refusal
        // built from a caught exception is @api's fixed sentence for its code,
        // and the transport puts its `ref` on the end (DPLAN-0414 C#1), so the
        // operator has something to find the real words by in the host's log.
        setError(cause instanceof HostError ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
    // The project is a dependency because it CHANGES THE ANSWER: the same ref
    // read under two projects is two different files. The ROOT is here for
    // exactly the same reason, and was missing: `README.md` under `home` and
    // under a project are two files, and a pane key is not a promise about
    // effects.
  }, [target.ref, target.kind, target.project, target.root]);

  /**
   * THE PATH OF THE FILE ON SCREEN - half the time you are already inside a
   * file when you want its name to hand to someone.
   *
   * Composed here rather than carried: the reference this sheet was opened with
   * is a NAME (`<branch>/<relative>`), and the floor that turns it into a
   * machine path arrives with the answer, not with the target. Before the read
   * lands there is genuinely nothing to copy, which is why the button appears
   * with the text rather than with the header.
   */
  const machine = machinePath(floor, underRoot(target.ref));

  /* THE LANE IS THE ANSWER (DPLAN-0414 A#21). Only a confirmed clipboard copy
     lights "copied"; the legacy lane - the only one over plain http on the
     tailnet - can say yes and land nothing, so it says that and holds the path
     out for a long-press. `copyThrough` reaches `execCommand` before its first
     await, so the copy still runs inside the tap. */
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
{/* A DIFF HAS NO PATH TO GIVE. It is a branch's patch, not a file, so
            the button is absent rather than present and refusing - the same
            rule the `⌂ home` chip on the files screen follows, and the honest
            one: there is nothing here that a machine path would name.

            AND IT ARRIVES WITH THE TEXT, not with the header. The floor comes
            back WITH the read, so a button drawn while the file is still in
            flight would refuse with "the server did not say where this root
            stands" - which would be a true sentence about the wrong moment. No
            text, no path, no button. */}
        {target.kind === "file" && text !== null ? (
          <button
            type="button"
            className={`baud-phone-copyhead ${copied ? "baud-phone-copy-done" : ""}`}
            onClick={copy}
          >
            {copied ? "copied" : "copy path"}
          </button>
        ) : null}
      </header>

      {said ? <p className="baud-phone-said">{said}</p> : null}
      {byHand ? <CopyByHand text={byHand} /> : null}
      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && text === null ? <p className="baud-phone-empty">reading…</p> : null}
      {truncated ? <p className="baud-phone-truncated">truncated by the server — this is the head of the file</p> : null}

      {/* AN EMPTY FILE SAYS SO (DPLAN-0414 A#22). A zero-byte file used to
          draw an empty `<pre>` under the head, which reads as a screen that
          never loaded - the real case was @memory's zero-byte certificate.
          Checked before any renderer: there is nothing for one to draw. */}
      {text === "" ? (
        <p className="baud-phone-empty">{target.kind === "diff" ? "this diff is empty" : "this file is empty"}</p>
      ) : null}
      {/* The designed render first, the file itself if it declined. `?? null`
          rather than a ternary on `render`: a renderer that says no is the
          same case as no renderer at all, and both land on the raw text. */}
      {text ? (render?.(text) ?? <pre className="baud-phone-text">{text}</pre>) : null}
    </section>
  );
}

/**
 * A path held out for Android's own long-press Copy (DPLAN-0414 A#21).
 *
 * Read-only and selected on focus, so one long-press offers Copy at once - the
 * terminal's takeout field, path-sized. Shared with the files screen, whose
 * rows answer a copy the same way.
 *
 * Args:
 *   text: The machine path to copy by hand.
 */
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
