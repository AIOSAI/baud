/**
 * The tokens as data (FPLAN-0412 phase 1).
 *
 * The desktop face never imports this - it reads the generated CSS custom
 * properties, which is what a stylesheet wants. This export exists for the
 * face that CANNOT read a stylesheet: a React Native phone app, where the same
 * palette has to arrive as a JS object.
 *
 * It is a reservation, not speculation: one export over the source that
 * already exists, so the phone stage inherits the palette instead of copying
 * it. Patrick's framing - build the skeleton, make reservations for what's
 * coming.
 */

import source from "./tokens.json";

/** `bg-card-live` -> `bgCardLive`. */
function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Every token, keyed camelCase without the `--baud-` prefix. */
export const tokens: Record<string, string> = Object.fromEntries(
  source.groups.flatMap((group) =>
    Object.entries(group.tokens).map(([name, value]) => [camel(name), value]),
  ),
);

/** The CSS custom property a token maps to - the bridge back to the stylesheet. */
export function cssVar(token: string): string {
  return `var(--baud-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)})`;
}
