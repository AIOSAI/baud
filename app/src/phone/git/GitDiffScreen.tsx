/** One file's patch via `react-diff-view`; the lane refuses a file over 512KB rather than truncating it.
 * Reference: docs/phone/files-git.md */

import { Fragment, useEffect, useState } from "react";
import { Decoration, Diff, Hunk, parseDiff } from "react-diff-view";
import type { FileData } from "react-diff-view";
// Its `--diff-*` custom properties are retuned to the phone's tokens in phone.css.
import "react-diff-view/style/index.css";

import { gitFileDiff } from "../../host";
import type { GitFileDiff } from "../../types";
import type { GitGrain } from "./GitApp";
import { splitPath } from "../lib/gitStatus";

interface GitDiffScreenProps {
  branch: string;
  project: string;
  /** The grain the path was spelled at: a path read at the other grain names the wrong file. */
  grain: GitGrain;
  /** The file, spelled exactly as the list that linked here spelled it. */
  path: string;
  /** The commit to read it out of, or "" for the working tree. */
  commitRef: string;
  onBack: () => void;
  /** Absent when this screen is one floor above home, since `back` already lands there. */
  onHome?: () => void;
}

export default function GitDiffScreen({
  branch,
  project,
  grain,
  path,
  commitRef,
  onBack,
  onHome,
}: GitDiffScreenProps) {
  const [patch, setPatch] = useState<GitFileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setPatch(null);
    setError(null);
    gitFileDiff({
      branch,
      project,
      path,
      // The lane refuses a grain beside a ref, and branch grain is the server default, so only repo grain is named.
      grain: commitRef || grain === "branch" ? "" : "repo",
      ref: commitRef,
    })
      .then((got) => {
        if (mounted) setPatch(got);
      })
      .catch((cause) => {
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [branch, project, grain, path, commitRef]);

  const { dir, name } = splitPath(path);
  /* A binary or mode-only change parses into zero hunks; treat it as unrenderable so the raw-patch fallback shows. */
  const parsed: FileData | null = patch ? (parseDiff(patch.diff)[0] ?? null) : null;
  const file = parsed && parsed.hunks.length > 0 ? parsed : null;

  return (
    <section className="baud-phone-reader baud-git">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onBack}>
          ‹ back
        </button>
        {onHome ? (
          <button type="button" className="baud-phone-home" onClick={onHome}>
            ⌂ home
          </button>
        ) : null}
        <span className="baud-phone-reader-title">{name}</span>
      </header>

      <div className="baud-git-difhead">
        <b>
          {dir ? <i>{dir}</i> : null}
          {name}
        </b>
        {patch ? (
          <p className="baud-git-difsub">
            {patch.bytes} bytes
            {patch.ref ? ` · ${patch.ref}` : " · working tree"}
            {" · 3 lines of context"}
          </p>
        ) : null}
      </div>

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && patch === null ? <p className="baud-phone-empty">reading…</p> : null}

      {patch?.truncated ? (
        <p className="baud-phone-truncated">
          the server capped this patch — what follows is the beginning of it, not all of it
        </p>
      ) : null}

      {patch && file ? (
        <div className="baud-git-diff">
          <Diff diffType={file.type} hunks={file.hunks} viewType="unified">
            {/* The library leaves the `@@` hunk header to the caller; without it hunks run together. */}
            {(hunks) =>
              hunks.map((hunk) => (
                <Fragment key={hunk.content}>
                  <Decoration>
                    <span className="baud-git-hunk">{hunk.content}</span>
                  </Decoration>
                  <Hunk hunk={hunk} />
                </Fragment>
              ))
            }
          </Diff>
        </div>
      ) : null}

      {/* A parse failure shows the raw patch, never a blank screen. */}
      {patch && !file ? (
        <pre className="baud-git-raw">{patch.diff || "the server sent an empty patch"}</pre>
      ) : null}

      {patch && file ? (
        <p className="baud-git-note">
          long lines fold at the edge — the whole patch scrolls with the page
        </p>
      ) : null}
    </section>
  );
}
