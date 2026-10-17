/** The git app's row, commit and remote rules, pure so gitWords.test.ts pins each one. */

import type { GitRemote } from "../../types";
import { chipOf } from "./gitStatus";

export type RowOpen = "diff" | "read" | "dir" | "file";

export const UNTRACKED_DIR_ANSWER = "new directory — nothing to diff; browse it from the files door";

export const UNTRACKED_FILE_ANSWER = "new file — nothing to diff; read it from the files door";

/** `git diff` cannot see a `??` path: a U file is read instead, at branch grain only (repo paths have no root). */
export function rowOpen(path: string, status: string, grain: "repo" | "branch"): RowOpen {
  if (chipOf(status) !== "U") return "diff";
  if (path.endsWith("/")) return "dir";
  return grain === "branch" ? "read" : "file";
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
