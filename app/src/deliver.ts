/**
 * Delivering a file to an agent: the path, quoted, in the operator's own line.
 *
 * THE PATH IS THE DELIVERY. `screenshot.rs` line 3 states the mechanism the
 * whole feature rests on - Claude Code reads images by path - so "send a
 * screenshot" is not an upload protocol, it is getting bytes onto disk and then
 * typing where they landed. The camera button, the drag-drop handler and the
 * phone's photo picker are three ways to produce a path and ONE way to deliver
 * it.
 *
 * THIS FUNCTION EXISTS BECAUSE THAT WAY MUST NOT BE WRITTEN TWICE. It was inline
 * in `App.tsx`'s `deliverPaths` until the phone needed it too. A quoting rule
 * that exists in two places is a quoting rule that drifts, and this one carries
 * shell semantics: the drifted copy does not render differently, it mis-escapes
 * a path and the operator's line means something else.
 *
 * THREE PROPERTIES, all deliberate:
 *  - QUOTED ONLY WHEN NEEDED. A plain path stays readable; one with whitespace
 *    or a quote in it gets POSIX single-quoting, `'` closed and re-opened as
 *    `'\''`. Quoting everything would work and would make the common line ugly.
 *  - WRAPPED IN SPACES, so it JOINS what the operator was already typing rather
 *    than colliding with it - "look at this" + path is one sentence.
 *  - NEVER SUBMITTED. There is no newline anywhere in here and there must never
 *    be one. Enter stays the operator's keystroke, on the desktop and in the
 *    pocket alike. Doctrine as of 2026-08-14, having carried three times in one
 *    evening: the desktop's chat box, `--send-room`'s `--text`, and now this.
 */

/** POSIX single-quoting, applied only to paths that actually need it. */
const quote = (text: string) => (/[\s'"]/.test(text) ? `'${text.replace(/'/g, `'\\''`)}'` : text);

/**
 * What to type into a session to hand it these paths.
 *
 * Returns the empty string for no paths, so a caller can write it
 * unconditionally without typing a stray pair of spaces into someone's prompt.
 */
export function deliveryText(paths: string[]): string {
  if (paths.length === 0) return "";
  return ` ${paths.map(quote).join(" ")} `;
}
