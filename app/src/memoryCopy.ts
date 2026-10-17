/** The memory panel's face-dependent words: the face's limits arrive as data (nulls, empty lists), never as a face check. */

/** What the caps section says on a face that has no caps lane at all. */
export const CAPS_AT_DESKTOP = "character caps are set at the desktop";

/** "desktop" only when the face has no caps lane AND there are no caps to show. */
export function capsLine(capCount: number, capsAtDesktop: boolean): "desktop" | "hook" {
  return capsAtDesktop && capCount === 0 ? "desktop" : "hook";
}

/** Only a FALSE somebody read warns; null is unknown, and unknown is not an alarm. */
export function enforcementWarns(enforced: boolean | null): boolean {
  return enforced === false;
}

/** Always "every branch": `rollover push` resets them all, not only the overrides. */
export function pushScope(overrides: number): string {
  if (overrides === 1) return "every branch, one with its own limits";
  return overrides > 1 ? `every branch, ${overrides} with their own limits` : "every branch";
}
