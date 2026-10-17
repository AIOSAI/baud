/**
 * What the git app decides about a row, a commit and a remote before it draws
 * them (DPLAN-0414 wave 5, T11). Pure - no JSX, no host - so each rule is
 * pinned in `gitWords.test.ts` rather than trusted to a screen.
 *
 * Four small rules, each one a screen that used to say something untrue:
 *  - an untracked row opened a diff screen that could only refuse (C#3);
 *  - a commit printed its subject twice (C#5) and a merge drew an empty
 *    "files changed" heading (C#6);
 *  - the sheet blamed a fleet read that had in fact answered (C#13);
 *  - a repository with no remote read as a refusal (C#12, contract C-D).
 */

import type { GitRemote } from "../../types";
import { chipOf } from "./gitStatus";

/**
 * What a tap on a changed-file row does.
 *
 * - `diff`: the diff screen, as every tracked row always has.
 * - `read`: the file itself in the Reader, through the files lane.
 * - `dir`: an answer under the row - a new directory has nothing to diff.
 * - `file`: an answer under the row - a new file at repo grain (see below).
 */
export type RowOpen = "diff" | "read" | "dir" | "file";

/** What a new directory's row answers when it is tapped (C#3). */
export const UNTRACKED_DIR_ANSWER = "new directory — nothing to diff; browse it from the files door";

/** What a new file's row answers at repo grain, where the Reader cannot be
 *  aimed at it (C#3, the HELD half). */
export const UNTRACKED_FILE_ANSWER = "new file — nothing to diff; read it from the files door";

/**
 * Where a changed-file row's tap goes (DPLAN-0414 C#3).
 *
 * GIT'S DIFF CANNOT SEE A FILE IT HAS NEVER SEEN. The diff lane is `git diff`,
 * so a `??` row - a green U, or a collapsed new `dir/` - could only open onto a
 * refusal. A U FILE is read instead, through the files lane, which is the one
 * place its content exists. A U DIRECTORY (git names it with a trailing slash
 * and never lists what is inside) answers under its row, the way the files
 * screen's gone row does.
 *
 * BRANCH GRAIN ONLY FOR THE READ. There the row's path is branch-local, and
 * `<branch>/<path>` is exactly what the files lane takes. At repo grain the
 * path is relative to whichever repository the branch sits in, and no root
 * this face can name is guaranteed to be that repository's top - so the row
 * answers instead of opening a read that might land on another file.
 *
 * Args:
 *   path: The row's path, as the changes lane sent it.
 *   status: Git's raw two-column code.
 *   grain: Which tree the list was read over.
 *
 * Returns:
 *   What the tap does.
 */
export function rowOpen(path: string, status: string, grain: "repo" | "branch"): RowOpen {
  if (chipOf(status) !== "U") return "diff";
  if (path.endsWith("/")) return "dir";
  return grain === "branch" ? "read" : "file";
}

/**
 * A commit message without its subject line (DPLAN-0414 C#5).
 *
 * @api's `message` is the WHOLE message and `subject` is its first line, so
 * drawing both printed the subject twice. The body is what is left after the
 * first line and the blank line(s) git puts under it; a one-line commit has
 * none, and "" tells the screen to draw no block at all.
 *
 * Args:
 *   message: The message whole, as the commit lane sent it.
 *
 * Returns:
 *   The body (the message is trimmed first, so its end carries no blank
 *   lines) - or "" when nothing is left.
 */
export function messageBody(message: string): string {
  const lines = message.trim().split(/\r?\n/);
  lines.shift();
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  return lines.join("\n");
}

/** What a commit with no file blocks of its own says under its head (C#6).
 *  @api splits the shown commit on `diff --git` headers, and a merge prints
 *  none - so the list is empty and the sentence says why. The brief's own
 *  words. An `--allow-empty` commit would land here too and be called a
 *  merge; the commit lane carries no parent count to tell the two apart. */
export const NO_FILES_OF_ITS_OWN = "this merge changes no files of its own";

/** The fleet read has not answered, so there is no agent to address the
 *  repository with yet (C#13: the old sentence, verbatim, kept for this case;
 *  its wording is C#18's, not this wave's). */
export const FLEET_NOT_LANDED =
  "no citizen named yet — the fleet read has not landed, so there is nothing to name the repository with";

/** The fleet read answered and this project has no agent (C#13). */
export const NO_AGENT_HERE = "no agent in this project to read the repository through";

/**
 * Why the git sheet has no agent to read the repository through (C#13).
 *
 * The seated project's card list is empty in two different worlds: the fleet
 * read has not answered yet, or it answered and the project has no agents.
 * Only the first is "has not landed".
 *
 * Args:
 *   fleetAnswered: The fleet read has answered at least once.
 *
 * Returns:
 *   The line the sheet shows instead of its rows.
 */
export function noAgentLine(fleetAnswered: boolean): string {
  return fleetAnswered ? NO_AGENT_HERE : FLEET_NOT_LANDED;
}

/** Where the links go when the repository has no remote (contract C-D). */
export const NO_REMOTE = "no remote configured — no links";

/**
 * Whether the remote read answered "no remote" (DPLAN-0414 C#12, contract C-D).
 *
 * @api answers a repository with no remote as 200 with `remote: null` (the
 * link fields null or absent). A missing or empty name is read the same way:
 * there is no remote to name a link after. A REFUSAL never reaches this - it is
 * thrown, and the sheet shows its sentence where the links go, which is also
 * what the old answer for "no remote" looks like until @api lands C-D.
 *
 * Args:
 *   got: The remote read's answer.
 *
 * Returns:
 *   True when there is no remote configured.
 */
export function noRemote(got: GitRemote): boolean {
  return !got.remote;
}
