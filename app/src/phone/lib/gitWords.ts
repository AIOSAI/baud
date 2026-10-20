/** The git app's row, commit and remote rules, pure so gitWords.test.ts pins each one. */

import type { GitRemote, GitRoot } from "../../types";
import { chipOf } from "./gitStatus";

export type RowOpen = "diff" | "read" | "browse" | "dir" | "file";

export const UNTRACKED_DIR_ANSWER = "new directory — nothing to diff; browse it from the files door";

export const UNTRACKED_FILE_ANSWER = "new file — nothing to diff; read it from the files door";

/** `git diff` cannot see a `??` path, so it is read or browsed, a repo path only through the answer's root; `dir` and `file` are words. */
export function rowOpen(path: string, status: string, grain: "repo" | "branch", root: GitRoot | null = null): RowOpen {
  if (chipOf(status) !== "U") return "diff";
  const rooted = grain === "repo" && root !== null;
  if (path.endsWith("/")) return rooted ? "browse" : "dir";
  return grain === "branch" || rooted ? "read" : "file";
}

export function rootAddress(root: GitRoot): { word: string; root: string } {
  return { word: root.name || root.kind, root: root.kind };
}

export function messageBody(message: string): string {
  const lines = message.trim().split(/\r?\n/);
  lines.shift();
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  return lines.join("\n");
}

/** A merge has no `diff --git` blocks; an `--allow-empty` commit lands here too (the lane carries no parent count). */
export const NO_FILES_OF_ITS_OWN = "this merge changes no files of its own";

export const FLEET_NOT_LANDED =
  "no citizen named yet — the fleet read has not landed, so there is nothing to name the repository with";

export const NO_AGENT_HERE = "no agent in this project to read the repository through";

export function noAgentLine(fleetAnswered: boolean): string {
  return fleetAnswered ? NO_AGENT_HERE : FLEET_NOT_LANDED;
}

export const NO_REMOTE = "no remote configured — no links";

export function noRemote(got: GitRemote): boolean {
  return !got.remote;
}
