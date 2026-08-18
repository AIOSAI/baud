/**
 * ONE CHANGED FILE, drawn the same way wherever a set of files is shown.
 *
 * The mock says it in one line - "same file-list idiom as changes, one
 * vocabulary for every set of files" - and this component is what makes that
 * true rather than aspirational: the changes screen and a commit's file list
 * are two different reads with two different envelopes, and they render through
 * one row. A second renderer is how the same file ends up looking like two
 * different kinds of thing on two screens.
 *
 * THE STAT IS OPTIONAL BECAUSE THE DATA IS. A commit knows how many lines moved
 * in each file; a working-tree status does not, and would have to run a second
 * subprocess per row to find out. So the changes screen passes no stat and the
 * row draws none - honest absence, not a zero.
 */

import { chipOf, splitPath } from "./gitStatus";

interface GitFileRowProps {
  /** The path as the row should READ - already relative to its group. */
  label: string;
  /** Git's raw two-column code. `gitStatus` is the only reader of it. */
  status: string;
  /** Lines added and removed, when the lane carries them. */
  additions?: number;
  deletions?: number;
  onOpen: () => void;
}

export default function GitFileRow({ label, status, additions, deletions, onOpen }: GitFileRowProps) {
  const chip = chipOf(status);
  const { dir, name } = splitPath(label);
  return (
    <button
      type="button"
      className={`baud-git-file baud-git-file-${chip}`}
      // The code git actually sent, kept reachable. The chip is one letter and
      // the letter is a summary; a long-press on a desk browser gets the two
      // columns back rather than having to trust the summary.
      title={`${status.trim() || "??"} ${label}`}
      onClick={onOpen}
    >
      <span className="baud-git-chip">{chip}</span>
      <span className="baud-git-path">
        {dir ? <i>{dir}</i> : null}
        <b>{name}</b>
      </span>
      {additions === undefined && deletions === undefined ? null : (
        <span className="baud-git-stat">
          {additions ? <span className="baud-git-plus">+{additions}</span> : null}
          {deletions ? <span className="baud-git-minus">−{deletions}</span> : null}
        </span>
      )}
    </button>
  );
}
