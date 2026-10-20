/** Every changed file in one tree, grouped for a phone; paths arrive at the grain they were asked for.
 * Reference: docs/phone/files-git.md */

import { useEffect, useMemo, useState } from "react";

import { gitChangeRows } from "../../host";
import type { GitRoot, GitRow } from "../../types";
import type { GitGrain } from "./GitApp";
import GitFileRow from "./GitFileRow";
import { splitPath } from "../lib/gitStatus";
import { UNTRACKED_DIR_ANSWER, UNTRACKED_FILE_ANSWER, rowOpen } from "../lib/gitWords";

// Three segments at repo grain (where branch roots sit), one at branch grain; grouping never adds, drops or reorders a row.
const GROUP_DEPTH: Record<GitGrain, number> = { repo: 3, branch: 1 };

/** Files with no directory, under a heading naming which root: the checkout top or the branch's own directory. */
const ROOT_GROUP: Record<GitGrain, string> = { repo: "(repo root)", branch: "(branch root)" };

interface Group {
  dir: string;
  rows: GitRow[];
}

interface GitChangesScreenProps {
  branch: string;
  project: string;
  grain: GitGrain;
  backLabel: string;
  /** A path at THIS grain, ready to hand straight back to the diff lane. */
  onOpenFile: (path: string) => void;
  /** An untracked file, to read rather than diff: branch-local with no root, else relative to `root`. */
  onReadFile: (path: string, root: GitRoot | null) => void;
  /** An untracked directory at repo grain, opened in the files door under `root`. */
  onBrowse: (path: string, root: GitRoot) => void;
  onBack: () => void;
}

export default function GitChangesScreen({
  branch,
  project,
  grain,
  backLabel,
  onOpenFile,
  onReadFile,
  onBrowse,
  onBack,
}: GitChangesScreenProps) {
  const [answer, setAnswer] = useState<{ rows: GitRow[]; untracked: number; root: GitRoot | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = answer?.rows ?? null;
  /** Which untracked row has an answer under it; a second tap closes it. */
  const [said, setSaid] = useState<{ path: string; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    setAnswer(null);
    setError(null);
    /* Branch grain is the server default and the transport drops an empty value, so it travels as "". */
    gitChangeRows(branch, project, grain === "repo" ? "repo" : "")
      .then((got) => {
        if (mounted) setAnswer({ rows: got.rows, untracked: got.untracked, root: got.root ?? null });
      })
      .catch((cause) => {
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [branch, project, grain]);

  const groups = useMemo(() => groupRows(rows ?? [], grain), [rows, grain]);

  const root = answer?.root ?? null;

  /** Untracked rows cannot be diffed: they open through a root when there is one, otherwise they answer under the row. */
  const open = (row: GitRow) => {
    const how = rowOpen(row.path, row.status, grain, root);
    if (how === "diff") {
      onOpenFile(row.path);
      return;
    }
    if (how === "read") {
      onReadFile(row.path, grain === "repo" ? root : null);
      return;
    }
    if (how === "browse" && root) {
      onBrowse(row.path, root);
      return;
    }
    const text = how === "dir" ? UNTRACKED_DIR_ANSWER : UNTRACKED_FILE_ANSWER;
    setSaid(said?.path === row.path ? null : { path: row.path, text });
  };

  return (
    <section className="baud-phone-reader baud-git">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onBack}>
          ‹ {backLabel}
        </button>
        {/* At repo grain the branch is only an address, so the title names no subject. */}
        <span className="baud-phone-reader-title">
          {grain === "branch" ? `${branch} · ` : null}
          <b className="baud-git-accent">CHANGES</b>
          {rows === null ? null : ` · ${rows.length} files`}
        </span>
      </header>

      {/* The untracked clause explains why the card's tile (tracked only) reads fewer than this list. */}
      <p className="baud-git-grain">
        {grain === "branch"
          ? "this branch's working tree — grouped by top-level directory"
          : "grouped by directory — the repo grain spans branches"}
        {grain === "branch" && answer && answer.untracked > 0
          ? ` · ${answer.untracked} untracked, which the card's tile does not count`
          : null}
      </p>

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && rows === null ? <p className="baud-phone-empty">reading…</p> : null}
      {rows !== null && rows.length === 0 ? (
        <p className="baud-phone-empty">nothing changed — the working tree matches HEAD</p>
      ) : null}

      <div className="baud-git-groups">
        {groups.map((group) => (
          <div key={group.dir} className="baud-git-group">
            <p className="baud-git-grouphead">{group.dir}</p>
            {group.rows.map((row) => (
              <div key={row.path} className="baud-git-fileblock">
                <GitFileRow
                  label={row.path.startsWith(group.dir) ? row.path.slice(group.dir.length) : row.path}
                  status={row.status}
                  onOpen={() => open(row)}
                />
                {said?.path === row.path ? <p className="baud-git-said">{said.text}</p> : null}
              </div>
            ))}
          </div>
        ))}
      </div>

      {rows !== null && rows.length > 0 ? (
        <p className="baud-git-note">M modified · A added · D deleted · U untracked</p>
      ) : null}
    </section>
  );
}

/** The server's rows under directory headings, in first-appearance order; git's own order is kept, never re-sorted. */
function groupRows(rows: GitRow[], grain: GitGrain): Group[] {
  const groups: Group[] = [];
  const seen = new Map<string, Group>();

  for (const row of rows) {
    const key = groupOf(row.path, grain);
    const held = seen.get(key);
    if (held) {
      held.rows.push(row);
      continue;
    }
    const group: Group = { dir: key, rows: [row] };
    seen.set(key, group);
    groups.push(group);
  }

  return groups;
}

/** Which heading a path belongs under: the directory cut to GROUP_DEPTH segments with its trailing slash, so heading plus label rebuilds the path. */
function groupOf(path: string, grain: GitGrain): string {
  const { dir } = splitPath(path);
  if (!dir) return ROOT_GROUP[grain];
  const segments = dir.split("/").filter((part) => part !== "");
  return `${segments.slice(0, GROUP_DEPTH[grain]).join("/")}/`;
}
