/**
 * Git's two-column porcelain code -> the one letter a phone row wears.
 *
 * THE ONLY PLACE THIS MAPPING LIVES. @api sends the code RAW and UNSTRIPPED
 * because the two columns are index then worktree, and 'A ' (staged new) and
 * ' M' (modified, unstaged) are different answers that collapse into one letter
 * the moment either is trimmed. Which code means which chip is deliberately
 * left to this face - their words: "a letter invented here would be a second
 * vocabulary for a fact git has already stated". This function is that
 * vocabulary, written once so the changes screen, a commit's file list and
 * anything that comes after cannot drift into two.
 */

/** The four letters this face draws, and nothing else. */
export type GitChip = "M" | "A" | "D" | "U";

/** Untracked, in git's own spelling. Never a status the index reports. */
const UNTRACKED = "??";

/**
 * What one row's chip says.
 *
 * THE PRECEDENCE IS DELIBERATE AND IT IS NOT ALPHABETICAL:
 *
 *  1. DELETED WINS. A file that is gone is the one status where acting on the
 *     row is impossible, so it must never be able to hide behind a second
 *     letter - 'AD' (added to the index, then deleted from the tree) is a file
 *     that is not there, whichever column you read first.
 *  2. UNTRACKED next, and it is only ever the whole code. '??' has no columns:
 *     git never reports it beside anything else.
 *  3. ADDED, from the INDEX column only. 'A ' is staged-new; the worktree
 *     column has no 'A' to confuse it with.
 *  4. EVERYTHING ELSE IS MODIFIED. Renames, copies, type changes, unmerged
 *     pairs - they are all "this file differs from HEAD", which is what the
 *     amber chip has meant on this face since the files screen learned git.
 *     A row is never dropped for wearing a code nobody anticipated.
 *
 * Args:
 *   status: The raw two-column code exactly as the server sent it. Shorter or
 *     padded input is tolerated - the columns are read by position, and a
 *     missing one is simply absent rather than an error.
 *
 * Returns:
 *   The letter the chip draws.
 */
export function chipOf(status: string): GitChip {
  const code = status ?? "";
  if (code.trim() === UNTRACKED) return "U";

  const index = code.charAt(0);
  const worktree = code.charAt(1);

  if (index === "D" || worktree === "D") return "D";
  if (index === "A") return "A";
  return "M";
}

/**
 * A path split where the eye needs it: the directory dim, the filename bright.
 *
 * Lives beside the chip because it is the same fact - how this face draws one
 * changed file - and a second module for one `lastIndexOf` would be a second
 * place for the two file lists to disagree about where a name begins.
 *
 * Args:
 *   path: A path with forward slashes. A bare filename has no directory half,
 *     which is a real answer and not an empty string standing in for one.
 *
 * Returns:
 *   `{ dir, name }` - `dir` keeps its trailing slash so the two halves
 *   concatenate back into exactly what was passed in.
 */
export function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? { dir: "", name: path } : { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}
