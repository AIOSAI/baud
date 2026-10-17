/**
 * EVERY CHANGED FILE IN ONE TREE, grouped so a phone can read it.
 *
 * A list, never a wall of diff - the mock's own rule, and the reason the diff
 * is one tap and one file away.
 *
 * WHICH TREE IS THE GRAIN'S ANSWER, and this screen serves both. At `repo`
 * grain the list spans every branch in the checkout at once, which is a scope
 * no agent card can honestly show and the whole reason the git app exists. At
 * `branch` grain it is one citizen's own working tree - the card's GIT tile,
 * which since Patrick's 08-17 ruling opens THIS screen rather than a raw patch.
 *
 * THE PATHS COME BACK AT THE GRAIN THEY WERE ASKED FOR and that is deliberate
 * upstream: at repo grain the `src/aipass/<branch>/` prefix IS the part that
 * differs between one branch's file and another's, so @api leaves it on; at
 * branch grain it is the part every row would share, so @api takes it off.
 * Neither shape is readable as a flat column of paths - the grouping below is
 * what makes each one readable, which is why the cut is the grain's too.
 */

import { useEffect, useMemo, useState } from "react";

import { gitChangeRows } from "../../host";
import type { GitRow } from "../../types";
import type { GitGrain } from "./GitApp";
import GitFileRow from "./GitFileRow";
import { splitPath } from "../lib/gitStatus";
import { UNTRACKED_DIR_ANSWER, UNTRACKED_FILE_ANSWER, rowOpen } from "../lib/gitWords";

/**
 * HOW DEEP A GROUP CUTS, PER GRAIN - a number rather than a rule about this
 * repository's names, and two numbers because the paths arrive two lengths.
 *
 * REPO: three segments. Three is where this fleet keeps its branch roots -
 * `src/aipass/<branch>/…` and `projects/<name>/<app>/…` - so one branch's tree
 * lands in one group and its own subdirectories stay together underneath it.
 * Shallower and the whole fleet collapses into `src/`; deeper and a branch
 * splinters into one heading per folder it happens to have touched.
 *
 * BRANCH: one segment. The branch root is already stripped, so the paths are
 * `README.md`, `docs/…`, `app/src/phone/…` - shallow, and cutting them at three
 * would give a heading per leaf folder with one or two rows under each, which
 * on a phone is more heading than list. One segment is the top-level directory,
 * which is how a citizen's own tree is actually thought about.
 *
 * IT IS PRESENTATION AND NOTHING ELSE, at either grain. Grouping never adds,
 * drops or reorders a row - every path the server sent is on this screen
 * exactly once, in the order it arrived. A repository laid out differently gets
 * uglier headings and the same complete list, which is the failure mode worth
 * having.
 */
const GROUP_DEPTH: Record<GitGrain, number> = { repo: 3, branch: 1 };

/**
 * Files with no directory at all, under a heading that says WHICH root they sit
 * at - and the two roots are not the same place. At repo grain it is the
 * checkout's own top level; at branch grain it is the citizen's own directory,
 * which is several levels down from that one.
 */
const ROOT_GROUP: Record<GitGrain, string> = { repo: "(repo root)", branch: "(branch root)" };

interface Group {
  /** The heading, with its trailing slash - or the grain's ROOT_GROUP. */
  dir: string;
  rows: GitRow[];
}

interface GitChangesScreenProps {
  branch: string;
  project: string;
  /** Which tree to read, and how to group what comes back. */
  grain: GitGrain;
  /** What the back chip returns to, in one word - the app decides it. */
  backLabel: string;
  /** A path at THIS grain, ready to hand straight back to the diff lane. */
  onOpenFile: (path: string) => void;
  /**
   * An untracked file at branch grain, to read rather than diff (DPLAN-0414
   * C#3). The path is branch-local, which is what the files lane takes.
   */
  onReadFile: (path: string) => void;
  onBack: () => void;
}

export default function GitChangesScreen({
  branch,
  project,
  grain,
  backLabel,
  onOpenFile,
  onReadFile,
  onBack,
}: GitChangesScreenProps) {
  /**
   * THE ENVELOPE, NOT JUST ITS ROWS - and the extra field earns its keep at
   * branch grain.
   *
   * `rows` is every changed path; `untracked` is how many of them git has never
   * seen. The card's GIT tile counts TRACKED files only, deliberately, because
   * that figure mirrors the desktop's card and the two faces must never
   * disagree about the same branch at the same moment. This screen lists both,
   * so on a branch with new files the tile says one number and this list holds
   * more rows than that. Neither is wrong and the gap is not a bug - so the
   * grain line names it rather than leaving the operator to find the
   * discrepancy and distrust both.
   */
  const [answer, setAnswer] = useState<{ rows: GitRow[]; untracked: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = answer?.rows ?? null;
  /**
   * WHICH ROW HAS AN ANSWER UNDER IT, and what it says (DPLAN-0414 C#3) - an
   * untracked row with nothing to diff answers where it was tapped, the way
   * the files screen's gone row does. One at a time; a second tap closes it.
   */
  const [said, setSaid] = useState<{ path: string; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    setAnswer(null);
    setError(null);
    /* BRANCH GRAIN TRAVELS AS SILENCE, and that is not a shortcut. The server's
       default IS the branch's own subtree, and the transport drops an empty
       query value entirely - so this asks the exact request the card, the badge
       sweep and the files screen have always sent. Spelling `branch` out would
       be a second way to say the same thing, and the day the default is what
       moves, one of the two spellings is the one that gets missed. */
    gitChangeRows(branch, project, grain === "repo" ? "repo" : "")
      .then((got) => {
        if (mounted) setAnswer({ rows: got.rows, untracked: got.untracked });
      })
      .catch((cause) => {
        // @api's own sentence, unreworded. A refusal here is a real answer -
        // no git in the tree, drone declining a foreign project, the lane down.
        // One built from a caught exception is the code's fixed sentence with
        // its `ref` on the end (DPLAN-0414 C#1): the reason is in the host's
        // log, under that ref.
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [branch, project, grain]);

  const groups = useMemo(() => groupRows(rows ?? [], grain), [rows, grain]);

  /**
   * WHERE A TAP GOES (DPLAN-0414 C#3). Tracked rows open their patch. An
   * untracked FILE at branch grain opens in the Reader - git's diff cannot see
   * a file it has never seen, so the diff screen could only refuse. An
   * untracked DIRECTORY, and an untracked file at repo grain (no root this face
   * can name is sure to be that repository's top), answer under the row.
   */
  const open = (row: GitRow) => {
    const how = rowOpen(row.path, row.status, grain);
    if (how === "diff") {
      onOpenFile(row.path);
      return;
    }
    if (how === "read") {
      onReadFile(row.path);
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
        {/* THE SUBJECT, WHEN THERE IS ONE. At branch grain the tree belongs to
            a citizen and the title says whose - the operator arrived from that
            card and the screen must agree with the card he pressed. At repo
            grain the branch is only an address for the checkout, so naming it
            would claim a scope the list does not have. Same shape as the app's
            own title (`<subject> · GIT`), and the count stays in ONE place at
            both grains - the title truncates with an ellipsis rather than
            wrapping, and a second home for the same number is how two lines
            end up disagreeing about it. */}
        <span className="baud-phone-reader-title">
          {grain === "branch" ? `${branch} · ` : null}
          <b className="baud-git-accent">CHANGES</b>
          {rows === null ? null : ` · ${rows.length} files`}
        </span>
      </header>

      {/* WHAT WAS MEASURED, before anything that was measured - and the two
          sentences are different facts, not two wordings of one.

          THE UNTRACKED CLAUSE IS BRANCH GRAIN'S ALONE, and it is there to
          explain a number the operator has just seen. The card's tile counts
          tracked files (the desktop's contract, kept on purpose); this list
          holds untracked ones too, so the tile can read 3 over a list of 5. At
          repo grain there is nothing to explain - that badge is measured from
          these very rows. */}
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
                  // The path MINUS its heading: the heading already carries the
                  // part every row in the group shares, and a phone screen is too
                  // narrow to spend it again on every line.
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

/**
 * The server's rows, gathered under directory headings.
 *
 * Args:
 *   rows: Every changed path with its code, in the order the server sent them.
 *   grain: Which tree they came from - it decides how deep a heading cuts and
 *     what the rootless files are gathered under.
 *
 * Returns:
 *   Groups in FIRST-APPEARANCE order, each holding its rows in arrival order.
 *   Nothing is sorted here: git's own ordering is already stable and meaningful,
 *   and re-sorting would be this face overruling it for a look.
 */
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

/**
 * Which heading a path belongs under.
 *
 * ONE FUNCTION, TWO CUTS. The rule is identical at both grains - take the
 * directory, keep the first N segments - and only N and the rootless heading
 * differ, so a second function would be this one copied with a constant
 * changed, which is where the two lists start looking like two ideas.
 *
 * Args:
 *   path: A path at `grain`'s own scope - repo-relative or branch-relative.
 *   grain: Which of those two it is.
 *
 * Returns:
 *   The directory cut to the grain's GROUP_DEPTH segments WITH its trailing
 *   slash, so the heading and the row's remainder concatenate back into the
 *   whole path - or the grain's ROOT_GROUP for a file with no directory at all.
 */
function groupOf(path: string, grain: GitGrain): string {
  const { dir } = splitPath(path);
  if (!dir) return ROOT_GROUP[grain];
  const segments = dir.split("/").filter((part) => part !== "");
  return `${segments.slice(0, GROUP_DEPTH[grain]).join("/")}/`;
}
