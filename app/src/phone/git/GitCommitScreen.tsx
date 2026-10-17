/** One commit: facts, message and per-file stats; each file's patch rides the diff lane one file at a time. */

import { useEffect, useState } from "react";

import { gitCommit } from "../../host";
import type { GitCommit } from "../../types";
import { NO_FILES_OF_ITS_OWN, messageBody } from "../lib/gitWords";
import GitFileRow from "./GitFileRow";

/** A commit file has no porcelain code and +/- cannot be turned back into one, so every row says only "modified". */
const TOUCHED_BY_THIS_COMMIT = "M ";

interface GitCommitScreenProps {
  branch: string;
  project: string;
  /** What was asked for. The answer carries the full sha it resolved to. */
  commitRef: string;
  onOpenFile: (path: string) => void;
  onBack: () => void;
  /** Absent when this screen is one floor above home, since `back` already lands there. */
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

  const body = commit ? messageBody(commit.message) : "";

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
            <b>{commit.sha}</b>
            <p className="baud-git-difsub">
              {commit.author}
              {commit.date ? ` · ${commit.date}` : ""}
              {` · ${commit.count} files`}
            </p>
          </div>

          <p className="baud-git-subject-line">{commit.subject}</p>

          {/* @api sends the message whole, subject included; `messageBody` drops the subject line. */}
          {body ? <pre className="baud-git-message">{body}</pre> : null}

          {/* A merge prints no `diff --git` headers, so its file list is empty. */}
          {commit.files.length === 0 ? (
            <p className="baud-phone-empty">{NO_FILES_OF_ITS_OWN}</p>
          ) : (
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
          )}
        </>
      ) : null}
    </section>
  );
}
