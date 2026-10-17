/** The tokens as a JS object, for a face that cannot read the generated stylesheet; the desktop uses the CSS. */

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
