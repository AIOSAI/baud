/**
 * ONE COMMIT - who, when, what it said, and which files moved.
 *
 * NO PATCH ON THIS SCREEN, by the lane's own design: the commit read answers
 * facts and per-file stats, and every file's patch rides the diff lane one file
 * at a time. A commit in this fleet routinely touches thirty files across four
 * branches, and loading that as one blob is the thing a phone cannot do.
 *
 * THE FILE LIST IS THE CHANGES SCREEN'S LIST, through the same row component -
 * one vocabulary for every set of files. What it adds is the stat, because a
 * commit knows how many lines moved and a working tree does not.
 *
 * EVERY ROW WEARS THE SAME LETTER, and that is a refusal to guess rather than a
 * shortcut. A commit's file carries additions and deletions and NO porcelain
 * code - a commit has no index and no worktree columns to report - and the two
 * numbers cannot be turned back into one. A file with no additions is as likely
 * to be five deleted lines as a deleted file; a file with no deletions is as
 * likely to be a new paragraph as a new file. Colouring those rows green and
 * red would put a confident wrong word on most of them, so they say the one
 * thing that is true of every file in a commit - this commit MODIFIED it - and
 * the +/- numbers beside the name carry what actually happened.
 */

import { useEffect, useState } from "react";

import { gitCommit } from "../../host";
import type { GitCommit } from "../../types";
import GitFileRow from "./GitFileRow";

/**
 * What a commit's file row says instead of a status it does not have.
 *
 * A porcelain code shaped the way the INDEX reports one, so it travels through
 * `gitStatus.chipOf` like every other row on this face - one vocabulary, one
 * reader, and this screen decides nothing about how a letter is drawn.
 */
const TOUCHED_BY_THIS_COMMIT = "M ";

interface GitCommitScreenProps {
  branch: string;
  project: string;
  /** What was asked for. The answer carries the full sha it resolved to. */
  commitRef: string;
  onOpenFile: (path: string) => void;
  onBack: () => void;
  /**
   * Straight to the floor the app opened on - or ABSENT when this screen is
   * only one floor above it, because then `back` already lands there and a
   * second chip onto the same screen says nothing. The app owns the stack, so
   * the app is what knows; this screen only draws what it was handed.
   */
  onHome?: () => void;
}

export default function GitCommitScreen({
  branch,
  project,
  commitRef,
  onOpenFile,
  onBack,
  onHome,
}: GitCommitScreenProps) {
  const [commit, setCommit] = useState<GitCommit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setCommit(null);
    setError(null);
    gitCommit(branch, commitRef, project)
      .then((got) => {
        if (mounted) setCommit(got);
      })
      .catch((cause) => {
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [branch, project, commitRef]);

  return (
    <section className="baud-phone-reader baud-git">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onBack}>
          ‹ commits
        </button>
        {onHome ? (
          <button type="button" className="baud-phone-home" onClick={onHome}>
            ⌂ home
          </button>
        ) : null}
        <span className="baud-phone-reader-title">{commitRef}</span>
      </header>

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && commit === null ? <p className="baud-phone-empty">reading…</p> : null}

      {commit ? (
        <>
          <div className="baud-git-difhead">
            {/* THE FULL SHA, not the short one the list showed. The list's job
                is recognition, this document's job is identification - and a
                seven-character name is not one, however convenient. */}
            <b>{commit.sha}</b>
            <p className="baud-git-difsub">
              {commit.author}
              {commit.date ? ` · ${commit.date}` : ""}
              {` · ${commit.count} files`}
            </p>
          </div>

          <p className="baud-git-subject-line">{commit.subject}</p>

          {/* THE BODY ONLY WHEN THERE IS ONE. @api sends the message whole and a
              one-line commit's body is empty; an empty block with a border
              around it is this face inventing an absence to draw. */}
          {commit.message.trim() ? <pre className="baud-git-message">{commit.message.trim()}</pre> : null}

          <div className="baud-git-groups">
            <div className="baud-git-group">
              <p className="baud-git-grouphead">files changed</p>
              {commit.files.map((file) => (
                <GitFileRow
                  key={file.path}
                  label={file.path}
                  status={TOUCHED_BY_THIS_COMMIT}
                  additions={file.additions}
                  deletions={file.deletions}
                  onOpen={() => onOpenFile(file.path)}
                />
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
