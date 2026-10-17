/** Git's raw two-column code -> a row's chip, the one place this lives: 'A ' and ' M' collapse if trimmed. */

export type GitChip = "M" | "A" | "D" | "U";

const UNTRACKED = "??";

/** Deleted wins (a gone file never hides behind a second letter), then `??`, then index `A`; all else is M. */
export function chipOf(status: string): GitChip {
  const code = status ?? "";
  if (code.trim() === UNTRACKED) return "U";

  const index = code.charAt(0);
  const worktree = code.charAt(1);

  if (index === "D" || worktree === "D") return "D";
  if (index === "A") return "A";
  return "M";
}

/** `dir` keeps its trailing slash, so the two halves concatenate back to the input. */
export function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? { dir: "", name: path } : { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}
