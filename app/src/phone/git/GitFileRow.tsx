/** One changed file, for the changes screen and a commit's list; no line counts draws no stat, never a zero. */

import { chipOf, splitPath } from "../lib/gitStatus";

interface GitFileRowProps {
  /** The path as the row should READ - already relative to its group. */
  label: string;
  /** Git's raw two-column code. `gitStatus` is the only reader of it. */
  status: string;
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
