/**
 * The repository's recent commits, a plain list: two short rows because the log door is `--oneline`, and always the whole repository because it runs with no pathspec.
 * Reference: docs/phone/files-git.md
 */

import { useEffect, useState } from "react";

import { gitLog } from "../../host";
import type { GitCommitRow } from "../../types";

/** The lane refuses anything outside 1..50 rather than clamping; twenty is about a working week here. */
const COMMIT_LIMIT = 20;

interface GitCommitsScreenProps {
  branch: string;
  project: string;
  onOpenCommit: (ref: string) => void;
  onBack: () => void;
}

export default function GitCommitsScreen({ branch, project, onOpenCommit, onBack }: GitCommitsScreenProps) {
  const [commits, setCommits] = useState<GitCommitRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setCommits(null);
    setError(null);
    gitLog(branch, project, COMMIT_LIMIT)
      .then((got) => {
        if (mounted) setCommits(got.commits);
      })
      .catch((cause) => {
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [branch, project]);

  return (
    <section className="baud-phone-reader baud-git">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onBack}>
          ‹ git
        </button>
        <span className="baud-phone-reader-title">
          <b className="baud-git-accent">COMMITS</b>
          {commits === null ? null : ` · latest ${commits.length}`}
        </span>
      </header>

      <p className="baud-git-grain">newest first — the whole repository, every branch</p>

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && commits === null ? <p className="baud-phone-empty">reading…</p> : null}
      {commits !== null && commits.length === 0 ? (
        <p className="baud-phone-empty">no commits in this repository yet</p>
      ) : null}

      <div className="baud-git-commits">
        {(commits ?? []).map((commit) => (
          <button
            key={commit.sha}
            type="button"
            className="baud-git-commit"
            onClick={() => onOpenCommit(commit.sha)}
          >
            <span className="baud-git-sha">{commit.sha}</span>
            {/* Clamped to two lines: one line of a fleet subject is just "feat(fleet):". */}
            <span className="baud-git-subject">{commit.subject}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
