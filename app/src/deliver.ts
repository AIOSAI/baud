/**
 * Delivering a file to an agent: the path, quoted, in the operator's own line.
 * Never submitted: no newline may appear here, Enter stays the operator's keystroke.
 * Reference: docs/phone/room-delivery.md
 */

/** POSIX single-quoting, applied only to paths that actually need it. */
const quote = (text: string) => (/[\s'"]/.test(text) ? `'${text.replace(/'/g, `'\\''`)}'` : text);

/**
 * What to type into a session to hand it these paths; empty for no paths, so a
 * caller can write it unconditionally without typing a stray pair of spaces.
 */
export function deliveryText(paths: string[]): string {
  if (paths.length === 0) return "";
  return ` ${paths.map(quote).join(" ")} `;
}
