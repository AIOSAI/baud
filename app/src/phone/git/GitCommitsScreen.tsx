/**
 * THE REPOSITORY'S RECENT COMMITS - a plain list, no graph.
 *
 * A branch's story is a straight line at 46 columns, which is what a phone
 * actually has; a graph on this screen would spend a third of the width drawing
 * the one thing the operator can already see by reading downwards.
 *
 * TWO SHORT ROWS, NOT THE MOCK'S FOUR FIELDS, and the divergence is upstream
 * and deliberate. The log lane routes through drone's `--oneline` door, so a
 * row carries an abbreviated object name and a subject and NOTHING else - no
 * author, no date. The mock drew both because a design can; showing them here
 * would mean fifty subprocesses each dragging a whole patch to decorate a list.
 * They are one tap away on the commit itself, where one read answers for one
 * commit, and that is where they stay until the log door carries more.
 *
 * ALWAYS THE WHOLE REPOSITORY. The branch names WHICH tree, never which
 * history: drone's log door runs from the repository root with no pathspec.
 * Saying "commits for devpulse" here would be a straight lie about what was
 * measured, so the screen says the repository and means it.
 */

import { useEffect, useState } from "react";

import { gitLog } from "../../host";
import type { GitCommitRow } from "../../types";

/**
 * How many commits to ask for.
 *
 * The lane serves 1 to 50 and REFUSES anything outside that rather than
 * clamping - so this number is a decision, not a hopeful maximum. Twenty is
 * about a screen and a half of scrolling on a phone and covers a working week
 * in this fleet; asking for fifty would mean most of the list exists to be
 * scrolled past.
 */
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
            {/* CLAMPED, NOT ELLIPSED TO ONE LINE. A commit subject in this fleet
                is a sentence, and one line of it at this width is the word
                "feat(fleet):" and nothing else - which tells the operator
                which commit it is not. Two lines is where a subject starts
                being recognisable; the whole message is one tap away. */}
            <span className="baud-git-subject">{commit.subject}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
