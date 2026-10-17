/**
 * The files door, phone-shaped: one directory level at a time.
 *
 * The desktop's FileTree holds a whole expanding tree in a side pane; a phone
 * screen holds one level and a thumb, so this browses the way a file manager
 * app does - tap a directory to enter it, `‹ up` to leave it, tap a file to
 * read it in the Reader that already exists.
 *
 * PATHS ARE NAMES HERE, same doctrine as the Reader: everything this screen
 * sends is `<branch>/<relative>`, everything it gets back is relative to the
 * branch root, and the server's fence refuses `..` and absolute shapes. The
 * noise filter (.git, node_modules, .venv...) is the server's, mirrored from
 * the desktop tree - machine residue, not content.
 *
 * AND SINCE FPLAN-0443 THE FLOOR CAN BE SOMEWHERE ELSE ENTIRELY. `root` names
 * which KIND of word `branch` is - a citizen, a project, the home directory,
 * the AIPass checkout - and everything above stays exactly true: the first
 * component is still a name the server resolves, the entries still come back
 * relative to whatever floor that was, and this screen still sends no path.
 * Nothing in the browse changed; what changed is how many places it can start.
 * A file explorer was never the missing piece - somewhere else to stand was.
 *
 * GIT RIDES THE ROW IT BELONGS TO (DPLAN-0303 phase 2, mock approved 08-17).
 * The listing is the same listing - a changed file is painted, never moved,
 * never grouped, never lifted out into a second screen. The one row this adds
 * is a file git says is gone: absence you can see, in the place the file used
 * to sit. A directory row wears a dot when anything beneath it changed, so a
 * level points at where the next tap goes instead of making you open folders
 * one by one to find out.
 *
 * THE WHOLE VOCABULARY, NOT HALF OF IT (Patrick's ruling, 08-17: "git activity,
 * green new, red deleted, amber edited, just like git works on vscode", and
 * "changes dont act different than git"). The rows lane carries git's own
 * two-column code per path and untracked files BY NAME, so this screen reads
 * the status instead of inferring one: `gitStatus.chipOf` turns the code into
 * the letter, exactly as the git app's file rows do. One mapping, one set of
 * colours, and a file cannot read as new here and modified one screen along.
 */

import { useEffect, useMemo, useState } from "react";

import { gitChangeRows, listDirWindow } from "../host";
import { HostError } from "../host/transport.http";
import type { DirEntryInfo } from "../types";
import { NO_FLOOR, copyShown, copyThrough, machinePath } from "./lib/copyPath";
import { chipOf, type GitChip } from "./lib/gitStatus";
import { CopyByHand } from "./Reader";

/** What a gone row answers when it is tapped. */
const GONE_ANSWER = "deleted - there is no file left to open";

/** The quiet line on a root that is not a branch (DPLAN-0414 C#11). */
export const NO_CHIPS_HERE = "git status is not shown here";

interface FilesScreenProps {
  /** The branch whose tree this browses. */
  branch: string;
  /** Which project that branch lives in - browsing is free across projects
   *  since 2026-08-16. Empty means the seat, the pre-ruling meaning. */
  project: string;
  /**
   * WHICH KIND OF WORD `branch` IS (FPLAN-0443) - `home`, `project`, `aipass`,
   * or `branch`. Empty is the branch meaning this screen has always had, and
   * it is sent as an absent key rather than a spelled-out default.
   *
   * It is never spelled here: it arrives from a `RootEntry` the server
   * published, through the picker, unchanged.
   */
  root?: string;
  /**
   * Where the browse STARTS, relative to the branch root. "" is the branch
   * itself, which is what the files door has always asked for.
   *
   * The passport's `artifacts` door asks for `artifacts` (compass #291), and it
   * is the same browse with a different floor - one directory lane, one refusal
   * voice, one Reader on the other side of a tap. A second component would have
   * been a second place for "the server said no" to be worded.
   */
  start?: string;
  /**
   * Where the browse OPENS, when that is not the floor (DPLAN-0414 C#9): the
   * level a file was opened from, handed back so `‹ back` on that file lands
   * in the same folder. Must sit at or under `start`; absent is the floor.
   */
  at?: string;
  /**
   * A file was tapped - open it in the Reader. `at` is the level it was
   * tapped on, so the caller can bring the browse back to it (C#9).
   */
  onOpenFile: (ref: string, title: string, at: string) => void;
  onClose: () => void;
}

/**
 * One row the browser paints.
 *
 * `entry` is a real thing on disk, exactly as the listing named it. `gone` is
 * the row with nothing behind it: git says the file differs from HEAD and the
 * directory does not contain it, which between them mean deleted. It carries
 * its own name because there is no `DirEntryInfo` to take one from - that is
 * the whole point of it.
 *
 * `chip` and `inside` are two different sentences and never both true: `chip`
 * is "git says THIS about this file", `inside` is "something under this
 * directory changed". A row is a file or a directory, so it gets at most one of
 * them - the letter and the dot cannot collide by construction.
 */
type FileRow =
  | { kind: "entry"; entry: DirEntryInfo; chip: GitChip | null; inside: boolean }
  | { kind: "gone"; path: string; name: string };

export default function FilesScreen({
  branch,
  project,
  root = "",
  start = "",
  at,
  onOpenFile,
  onClose,
}: FilesScreenProps) {
  /** Where we are, relative to the branch root. "" is the root itself. Opens
   *  at `at` when a file's back brought the browse here (C#9) - read once, so
   *  the caller keys this screen on it - and never above the floor. */
  const [dir, setDir] = useState(() => (at !== undefined && isAtOrUnder(at, start) ? at : start));
  const [entries, setEntries] = useState<DirEntryInfo[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The branch's changed files and what git says about each, keyed by their
   * branch-local path - the same space `entry.path` is spelled in, measured
   * rather than assumed: /v1/dir answers with `child.relative_to(branch_root)`,
   * and /v1/git-changes strips the branch's repo-relative prefix off drone's
   * rows for exactly this reason. So the join is a lookup on `entry.path` with
   * nothing to concatenate, and any prefixing here would be inventing a
   * mismatch.
   *
   * `null` means not answered - either still in flight, or refused. Both paint
   * the listing plain, which is the honest thing in both cases (see below).
   */
  const [changed, setChanged] = useState<ReadonlyMap<string, GitChip> | null>(null);
  /**
   * WHICH ROW HAS SOMETHING TO SAY, and what it says.
   *
   * It began as the gone row's own answer and widened when the copy button
   * arrived, because a refused copy is the same species of thing: news about
   * ONE row, belonging under that row rather than in a banner over a listing
   * that is otherwise perfectly true. One answer at a time, by construction -
   * a screen with four open explanations on it is a screen nobody reads.
   *
   * `byHand` is the copy's own half (DPLAN-0414 A#21): when no lane confirmed
   * the copy, the path is held out under the row for a long-press Copy.
   */
  const [said, setSaid] = useState<{ path: string; text: string; byHand?: string } | null>(null);
  /**
   * WHERE THIS LEVEL STANDS ON THE MACHINE, straight from the answer. "" is a
   * server that has not sent it, and the copy button refuses on "" rather than
   * composing a path out of half the facts.
   */
  const [floor, setFloor] = useState("");
  /**
   * WHICH ROW'S PATH IS ON THE CLIPBOARD, and it does NOT time out.
   *
   * A tick that fades after two seconds would be claiming the copy expired; the
   * clipboard still holds the path, and this mark is the only record of which
   * one. It is cleared when the level changes instead - not because the
   * clipboard emptied, but because the row it pointed at is no longer on
   * screen, and a mark that outlived its row could land on a same-named file
   * somewhere else.
   */
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setEntries(null);
    setError(null);
    setSaid(null);
    setCopied(null);
    setFloor("");
    listDirWindow(dir ? `${branch}/${dir}` : branch, project, root)
      .then((got) => {
        if (!mounted) return;
        setEntries(got.entries);
        setTruncated(got.truncated);
        setFloor(got.floor ?? "");
      })
      .catch((cause) => {
        if (!mounted) return;
        // @api's sentence, unreworded - the fence's own refusals name
        // themselves; one built from a caught exception is the code's fixed
        // sentence with its `ref` on the end (DPLAN-0414 C#1).
        setError(cause instanceof HostError ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [branch, project, root, dir]);

  /*
   * ONE FETCH PER SCREEN, NOT ONE PER FOLDER. `dir` is deliberately absent
   * from the dependency list: the change set is a property of the BRANCH, so
   * walking six directories deep must not ask the host six times for the same
   * answer. It is re-asked only when the screen is pointed at another branch.
   *
   * This lane is this screen's own. The badge sweep in PhoneApp asks the
   * narrower `gitChanges` on a timer and holds its own counts; joining them
   * would make a browse depend on where a rotating cursor happens to be, and
   * make the sweep responsible for a screen it knows nothing about. One lane
   * per surface - and the sweep wants a NUMBER in the desktop's exact
   * semantics, where this screen wants every row with git's code beside it.
   *
   * BRANCH GRAIN TRAVELS AS SILENCE, the same request this screen has always
   * sent: the server's default is the branch's own subtree, so an empty `grain`
   * is not a shortcut but the spelling every other branch-grain caller uses.
   *
   * A REFUSAL IS QUIET, AND THAT IS THE POINT. No git in the branch, a foreign
   * project drone declines to verify, the host lane down - none of those make
   * the LISTING less true. The files are still the files. So the browser falls
   * back to exactly what it rendered yesterday rather than putting an error
   * banner over a directory that is perfectly readable.
   */
  useEffect(() => {
    let mounted = true;
    setChanged(null);
    /* CHIPS ARE OFF OUTSIDE A BRANCH ROOT (FPLAN-0443), and SAID since
       DPLAN-0414 C#11 - one quiet line under the head, `NO_CHIPS_HERE`. The rows
       lane is keyed BY A BRANCH: it answers "what has changed in this
       citizen's working tree". Outside one there is no branch to key on - a
       home directory is not a repository, and a project root is a repository
       this lane cannot be asked about at this grain. Sending a root's name
       where a branch name goes would return either a refusal or, far worse,
       some same-named citizen's change set painted over a stranger's files.

       SO THE LISTING GOES OUT PLAIN, which is the same picture this screen
       drew before it ever learned to read status: an unpainted row claims
       nothing, where a row painted clean would claim the file is unchanged.
       Never a false clean. But an operator who knows the branch roots paint
       their changes read the plain rows here as clean, so the screen now says
       the chips are off - one quiet line, not a banner. Lighting them at
       repo grain for the project and aipass roots is real and named as a
       follow-on in the plan - the `repo` grain already exists - and it is off
       here rather than guessed, because a chip keyed wrong is worse than no
       chip at all. */
    if (root && root !== "branch") {
      return () => {
        mounted = false;
      };
    }
    gitChangeRows(branch, project)
      .then((got) => {
        if (!mounted) return;
        const held = new Map<string, GitChip>();
        for (const row of got.rows) {
          const chip = chipOf(row.status);
          /* ONE PATH CAN ARRIVE TWICE and only one way: `git rm --cached x`
             leaves the index saying deleted and the worktree holding an
             untracked copy, and git reports both rows for the same name.
             Untracked is the true statement about a row you can still tap -
             the file is there, and git has never seen this copy of it - so
             '??' wins a repeat and nothing else does. Read through `chipOf`
             rather than against the raw code: the spelling of untracked lives
             in one module and this is not it. */
          if (!held.has(row.path) || chip === "U") held.set(row.path, chip);
        }
        setChanged(held);
      })
      .catch(() => {
        /* Nothing written, nothing said - see above. */
      });
    return () => {
      mounted = false;
    };
  }, [branch, project, root]);

  const rows = useMemo(
    () => buildRows(entries, changed, dir, truncated),
    [entries, changed, dir, truncated],
  );

  /** One level back, or out of the screen from the FLOOR - the same button.
   *  The floor is where the browse started, so the artifacts door does not
   *  climb out into the branch root on its way back to where it came from. */
  const up = () => {
    if (dir === start) {
      onClose();
      return;
    }
    const cut = dir.lastIndexOf("/");
    const next = cut < 0 ? "" : dir.slice(0, cut);
    setDir(next.length < start.length ? start : next);
  };

  /** THE FLOOR IN ONE TAP, and it is `up` repeated rather than a second way of
   *  moving: `dir` is the whole of where we are, so setting it to the floor
   *  re-reads that level exactly as walking there does - same listing effect,
   *  same refusal voice, same cleared answer under a gone row. The floor is the
   *  browse's own, so the passport's artifacts door goes home to `artifacts`
   *  and never up into the branch root it did not come from. */
  const home = () => setDir(start);

  /**
   * HAND A ROW'S PATH TO THE OPERATOR, or say why not.
   *
   * Nothing here assumes anything worked. The floor can be missing, the
   * browser can refuse the clipboard outright, and both are ANSWERED under the
   * row rather than swallowed - a copy button that always looks like it worked
   * is worse than no copy button, because the operator's next move is to paste
   * something that is not there.
   *
   * ONE ARGUMENT, because there is one path. A row's path is BOTH the key the
   * mark and the answer hang on AND the thing that goes after the floor - the
   * listing spells entry paths relative to the root it stands on, measured on
   * the wire rather than assumed (a level three deep answers
   * `app/src/phone/Reader.tsx`, not `Reader.tsx`). Passing it twice would have
   * been two names for one fact and one more place for them to disagree.
   *
   * Args:
   *   path: The row's path, relative to the root this level stands on.
   */
  const copy = async (path: string) => {
    setSaid(null);
    setCopied(null);
    const machine = machinePath(floor, path);
    if (!machine) {
      setSaid({ path, text: NO_FLOOR });
      return;
    }
    /* THE LANE IS THE ANSWER (DPLAN-0414 A#21 = C#7). "copied" only for a
       confirmed clipboard copy; the legacy lane over plain http says so under
       the row and holds the path out for a long-press. `copyThrough` reaches
       `execCommand` before its first await, so the copy runs inside the tap. */
    const shown = copyShown(await copyThrough(machine), machine);
    if (shown.copied) setCopied(path);
    if (shown.note) setSaid({ path, text: shown.note, byHand: shown.byHand ?? undefined });
  };

  /* HOW MANY `up` PRESSES FROM HOME. The chip is drawn from two down, where it
     replaces them; one down is `up`'s own job, and a second chip pointing at
     the level `back` already reaches is chrome with nothing behind it. Both
     sides are branch-relative and `dir` only ever extends the floor, so the
     remainder IS the walk - counted, not re-derived from the tree. */
  const below = dir === start ? 0 : dir.slice(start.length).split("/").filter(Boolean).length;

  /* WHAT THIS BROWSE IS CALLED. A branch names itself, and so does a project;
     `home` and `aipass` name nothing, because the fence resolves them from the
     kind alone - so `branch` is empty and the heading falls back to the kind,
     which is the word the operator picked off the roster. Display only: what
     goes on the wire is `branch` and `root`, untouched. */
  const title = branch || root || "files";

  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={up}>
          ‹ {dir === start ? "back" : "up"}
        </button>
        {below >= 2 ? (
          <button type="button" className="baud-phone-home" onClick={home}>
            ⌂ home
          </button>
        ) : null}
        <span className="baud-phone-reader-title">
          {title}
          {dir ? `/${dir}` : ""}
        </span>
      </header>

      {/* THE CHIPS ARE OFF HERE, AND THE SCREEN SAYS SO (DPLAN-0414 C#11).
          Same test as the git effect above - one rule, two readers. */}
      {root && root !== "branch" ? <p className="baud-phone-files-quiet">{NO_CHIPS_HERE}</p> : null}

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {!error && entries === null ? <p className="baud-phone-empty">listing…</p> : null}
      {truncated ? (
        <p className="baud-phone-truncated">
          long directory - the server dropped the tail of this level
        </p>
      ) : null}

      {entries !== null ? (
        <div className="baud-phone-files">
          {/* ROWS, not entries: a directory whose last file was deleted lists
              nothing and still has a row to show, and "empty directory" over a
              visible row would be the screen contradicting itself. */}
          {rows.length === 0 ? <p className="baud-phone-empty">empty directory</p> : null}
          {rows.map((row) =>
            row.kind === "gone" ? (
              /* PRESSABLE, NEVER `disabled` - this face's own rule, written on
                 `baud-phone-verb-refused`: a disabled button on touch has no
                 hover, no title and no answer. So the dead row stays tappable
                 and answers with WHY it is dead, right underneath itself.
                 AND IT COPIES, like every other row (FPLAN-0443 rider): a
                 deleted file's path is one of the things a person most wants to
                 hand to an agent, and the row is the only place it is still
                 written down. */
              <div key={row.path} className="baud-phone-file-block">
                <div className="baud-phone-file-row baud-phone-file-gone">
                  <button
                    type="button"
                    className="baud-phone-file"
                    onClick={() =>
                      setSaid(
                        said?.path === row.path && said.text === GONE_ANSWER
                          ? null
                          : { path: row.path, text: GONE_ANSWER },
                      )
                    }
                  >
                    <span className="baud-phone-file-name">{row.name}</span>
                  </button>
                  <CopyButton done={copied === row.path} onCopy={() => copy(row.path)} />
                  <span className="baud-phone-file-chip">D</span>
                </div>
                {said?.path === row.path ? <p className="baud-phone-said">{said.text}</p> : null}
                {said?.path === row.path && said.byHand ? <CopyByHand text={said.byHand} /> : null}
              </div>
            ) : (
              <div key={row.entry.path} className="baud-phone-file-block">
                <div
                  /* ONE CLASS PER STATUS, named by the letter itself - the git
                     app's own idiom (`baud-git-file-${chip}`), so the two
                     screens cannot drift into two palettes for one fact.
                     THE ROW WEARS THEM NOW, not the button inside it: the chip
                     moved out to make room for the copy button on its left, and
                     it draws its border in `currentColor`. The colour has to be
                     set somewhere both the name and the chip inherit it from,
                     and that place is their common parent. */
                  className={`baud-phone-file-row ${row.entry.is_dir ? "baud-phone-file-dir" : ""} ${
                    row.chip ? `baud-phone-file-${row.chip}` : ""
                  } ${row.inside ? "baud-phone-file-inside" : ""}`}
                >
                  <button
                    type="button"
                    className="baud-phone-file"
                    onClick={() =>
                      row.entry.is_dir
                        ? setDir(row.entry.path)
                        : onOpenFile(
                            `${branch}/${row.entry.path}`,
                            `${title} · ${row.entry.name}`,
                            dir,
                          )
                    }
                  >
                    <span className="baud-phone-file-name">
                      {row.entry.name}
                      {row.entry.is_dir ? "/" : ""}
                    </span>
                  </button>
                  <CopyButton done={copied === row.entry.path} onCopy={() => copy(row.entry.path)} />
                  {/* ONE 17px SLOT ON EVERY ROW, holding the chip, or the dot,
                      or nothing. Chip and dot were always exclusive; what is
                      new is that a row with NEITHER still reserves the space,
                      so the copy button beside it lands in the same column all
                      the way down the listing. A button that shifts 25px
                      sideways between adjacent rows is a button a thumb misses.

                      A DOT, NOT A LETTER. What that row knows is that something
                      under it moved - not what, not how many, not whether the
                      thing was edited or deleted. A chip would have to pick a
                      letter to say that with, and every letter available claims
                      more than the row has. So the marker says exactly the one
                      true word, "inside", and the tap is how you learn the
                      rest. */}
                  <span
                    className={
                      row.chip
                        ? "baud-phone-file-chip"
                        : row.inside
                          ? "baud-phone-file-dot"
                          : "baud-phone-file-slot"
                    }
                  >
                    {row.chip}
                  </span>
                </div>
                {said?.path === row.entry.path ? (
                  <p className="baud-phone-said">{said.text}</p>
                ) : null}
                {said?.path === row.entry.path && said.byHand ? <CopyByHand text={said.byHand} /> : null}
              </div>
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The copy button one row wears.
 *
 * "copied" ONLY ON A CONFIRMED COPY (DPLAN-0414 A#21): `done` is set from
 * `copyShown`, which keeps the legacy lane's unconfirmed yes off the button.
 *
 * A WORD, NOT A GLYPH, and both states are words. Every copy icon in circulation
 * is two overlapping rectangles that nobody recognises at 17px, and the ones
 * that read well live in font blocks this face cannot promise an Android phone
 * has - a tofu box on every row is a worse outcome than a small word. "copied"
 * replacing "copy" is also the state change itself: the label IS the answer,
 * so there is no second element to look at.
 *
 * IT IS A SIBLING OF THE ROW, NOT A CHILD OF IT, and that is not a style
 * choice - a button inside a button is invalid HTML and the browser is entitled
 * to do anything at all with the tap. So the row became a flex line holding the
 * name button, this, and the status slot, in that order.
 *
 * Args:
 *   done: This row's path is the one on the clipboard.
 *   onCopy: Put it there.
 */
function CopyButton({ done, onCopy }: { done: boolean; onCopy: () => void }) {
  return (
    <button
      type="button"
      className={`baud-phone-copy ${done ? "baud-phone-copy-done" : ""}`}
      onClick={onCopy}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

/**
 * The listing, with git's answer folded into it.
 *
 * FOLDERS POINT AT WHAT IS INSIDE THEM (Patrick's ruling, 08-17: folders stayed
 * white and he had to hunt for the changes under them). Any changed path at any
 * depth beneath a directory marks that directory, VS Code's idiom - and the
 * edge that kept it out of the last round is settled by SIMPLIFYING the rule
 * rather than by answering it. "Does a deletion three deep make the parent
 * modified or gone?" turns out to be the wrong question: an ancestor carries no
 * letter and no M/D distinction at all, only a dot. A folder says SOMETHING
 * INSIDE; the letter belongs to the file that owns it, and opening the folder
 * is how you find out which. The simplification IS the ruling, not a first cut
 * at one - there is no richer version of this waiting to be built.
 *
 * DELETIONS COUNT TOO. A folder whose only content was deleted still earns the
 * pointer: there is something in there to see (the gone rows), and a white row
 * would send the eye straight past it.
 *
 * WHAT THE LANE SAYS NOW. The rows lane carries git's own two-column code with
 * every path and names untracked files instead of counting them, so all four
 * chips have data behind them and the letter is READ rather than inferred -
 * this is the widening the last round left a note for. A DELETED ROW IS NOW
 * GIT'S WORD, not the listing's silence: a path earns the gone row only when
 * its code says D *and* the directory does not hold it. Absence alone used to
 * carry that claim by itself, which was true of every case anyone could reach
 * and is a lie waiting on the one nobody had - a modified file the listing
 * happens not to name would have been drawn struck through and dead.
 *
 * WHAT THE LANE STILL CANNOT SAY, measured on the real wire rather than
 * guessed: `git status --porcelain` collapses a WHOLLY new directory into one
 * row, `dir/`, and never names what is inside it - that expansion is `-uall`,
 * which the lane does not ask for because the count beside it is @baud's card
 * contract. So the folder marks (its own trailing-slash path sits beneath
 * itself and the dot scan finds it) and the new files inside it read plain
 * until you have looked. Nothing here infers them green: "under an untracked
 * directory" is not a status git said about a file, and a file it ignores can
 * live there too. The fix is one flag upstream, not a rule invented down here.
 *
 * Args:
 *   entries: The level as the server listed it, or null while it is in flight.
 *   changed: Branch-local changed paths and git's letter for each, or null
 *     when unknown.
 *   dir: Where we are, relative to the branch root.
 *   truncated: The server dropped the tail of this level.
 *
 * Returns:
 *   Rows in the server's own order - directories first, then files by name -
 *   with deleted files inserted where their names put them.
 */
function buildRows(
  entries: DirEntryInfo[] | null,
  changed: ReadonlyMap<string, GitChip> | null,
  dir: string,
  truncated: boolean,
): FileRow[] {
  if (entries === null) return [];

  /* THE DOT DOES NOT CARE THAT THE LEVEL WAS TRUNCATED, though the gone rows
     below refuse to be built on one. The two lean on the listing in opposite
     directions. A gone row is INVENTED out of a name the level did not
     contain, so a dropped tail can turn it into a lie about a file that is
     really sitting there. A dot only decorates a directory row the server
     actually sent, matched against a changed path living BENEATH that
     directory - never in this level's list in the first place. A dropped tail
     can therefore hide further changes, but it can never unmake the one we
     matched: the worst it does is leave another folder unmarked, which is the
     same silence an unanswered git lane already gives. */
  const rows: FileRow[] = entries.map((entry) => ({
    kind: "entry",
    entry,
    chip: entry.is_dir || changed === null ? null : (changed.get(entry.path) ?? null),
    inside: entry.is_dir && changed !== null && holdsChange(changed, entry.path),
  }));

  /* NO GHOSTS OFF A PARTIAL LISTING. "Changed but not listed here" only means
     deleted when the listing is WHOLE; on a truncated level the file may
     simply be in the tail the server dropped, and a red struck-through row for
     a file that exists is a worse lie than the missing row it replaces. */
  if (changed === null || truncated) return rows;

  const prefix = dir ? `${dir}/` : "";
  const listed = new Set(entries.map((entry) => entry.path));

  for (const [path, chip] of changed) {
    /* A GONE ROW IS FOR A FILE GIT CALLED GONE. Every other letter describes a
       file that is somewhere - a new one the level lists, an edited one, a
       collapsed untracked directory git names with a trailing slash - and
       synthesizing a dead row for any of them would be this screen inventing a
       deletion out of a name it could not match. */
    if (chip !== "D") continue;
    if (listed.has(path)) continue;
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    // A name with a slash left in it lives DEEPER than this level, and an
    // empty one is not a file at all.
    if (name === "" || name.includes("/")) continue;
    rows.splice(placeOf(rows, name), 0, { kind: "gone", path, name });
  }

  return rows;
}

/**
 * Whether anything git named lives beneath this directory.
 *
 * THE TRAILING SLASH IS THE WHOLE FUNCTION. Matching on the bare directory
 * name would make `src` claim `srcgen/main.ts` and `README.md` claim nothing
 * while `READ` claimed it - prefix matching over paths only means "beneath"
 * when the separator is part of the prefix.
 *
 * Both sides are branch-relative, measured last round and unchanged here:
 * /v1/dir answers `child.relative_to(branch_root)` and /v1/git-changes strips
 * the branch's repo-relative prefix, so `entry.path` and the changed paths are
 * spelled in one space and there is nothing to join on but the string.
 *
 * A scan per directory row rather than a prepared index: a phone level holds
 * a handful of folders and a branch holds a handful of changes, so the index
 * would cost more to explain than the loop costs to run.
 *
 * EVERY LETTER COUNTS THE SAME. The scan reads the changed paths and not their
 * codes: a folder holding one new file has something in it to see exactly as a
 * folder holding one edited file does, and a dot that only answered for some
 * statuses would send the eye past the rest.
 *
 * Args:
 *   changed: Branch-local changed paths and git's letter for each.
 *   dir: A directory's path, relative to the branch root.
 *
 * Returns:
 *   True when at least one changed path sits under it, at any depth.
 */
function holdsChange(changed: ReadonlyMap<string, GitChip>, dir: string): boolean {
  const under = `${dir}/`;
  for (const path of changed.keys()) {
    if (path.startsWith(under)) return true;
  }
  return false;
}

/**
 * Where a deleted file's row belongs, by the server's own ordering rule.
 *
 * The rule is /v1/dir's, copied rather than re-decided: directories first,
 * then files by lower-cased name. Inserting into the listing this way leaves
 * every row the server sent exactly where it sent it - re-sorting the whole
 * level with a JS comparator would risk shuffling the untouched case to fix
 * the new one.
 *
 * Args:
 *   rows: Rows built so far, in server order.
 *   name: The deleted file's name.
 *
 * Returns:
 *   The index to splice at - past every directory, alphabetically among files.
 */
function placeOf(rows: FileRow[], name: string): number {
  const key = name.toLowerCase();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.kind === "entry" && row.entry.is_dir) continue;
    const other = row.kind === "entry" ? row.entry.name : row.name;
    if (other.toLowerCase() > key) return i;
  }
  return rows.length;
}

/**
 * Whether a level sits at or under the browse's floor (DPLAN-0414 C#9).
 *
 * The level a file was opened from is handed back to a new browse, and the
 * floor is where that browse may climb to and no further - so a level above
 * it (it cannot happen through the doors that exist, which is exactly when a
 * check is cheap) falls back to the floor rather than opening outside it.
 *
 * Args:
 *   level: The level to open at, relative to the root.
 *   floor: The browse's floor, relative to the same root.
 *
 * Returns:
 *   True when `level` is the floor or a directory beneath it.
 */
function isAtOrUnder(level: string, floor: string): boolean {
  return !floor || level === floor || level.startsWith(`${floor}/`);
}
