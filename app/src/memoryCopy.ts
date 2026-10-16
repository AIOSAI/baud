/**
 * THE MEMORY PANEL'S WORDS THAT DEPEND ON WHICH FACE READ THE CONFIG
 * (DPLAN-0414 A#6, A#7, A#8).
 *
 * `desktop/MemorySettings.tsx` is ONE panel on two faces. The desktop reads
 * @memory's file and knows the path, the enforcement flag and the character
 * caps. The phone reads `/v1/memory-config`, which reports none of the three.
 * The difference travels as DATA - a null the transport hands up, an empty
 * list, a flag the phone passes - and these rules turn it into words. None of
 * them branches on the face itself, so the desktop, with its real values,
 * draws exactly what it drew before.
 */

/** What the caps section says on a face that has no caps lane at all. */
export const CAPS_AT_DESKTOP = "character caps are set at the desktop";

/**
 * Which caps line the panel draws.
 *
 * "desktop" only when BOTH hold: the face said it has no caps lane, and there
 * are no caps to show. A desktop with an empty list keeps its own sentence
 * (it can still read the hook's file), and a face that somehow did get caps
 * shows them under the usual heading.
 */
export function capsLine(capCount: number, capsAtDesktop: boolean): "desktop" | "hook" {
  return capsAtDesktop && capCount === 0 ? "desktop" : "hook";
}

/**
 * Whether the amber "enforcement is OFF" warning shows.
 *
 * Only on a FALSE that somebody read. Null is unknown (the phone's route makes
 * no statement about the hook), and an unknown is not an alarm.
 */
export function enforcementWarns(enforced: boolean | null): boolean {
  return enforced === false;
}

/**
 * Who the push confirm says it resets.
 *
 * Always "every branch", because that is what `rollover push` resets; the
 * branches holding their own limits are named by count, since they are the
 * ones that lose something. It used to say "ALL N branches" with N the
 * override count (an undercount: push does not stop at the overrides) and, with
 * none, a literal 17 that was a guess at this fleet's size.
 */
export function pushScope(overrides: number): string {
  if (overrides === 1) return "every branch, one with its own limits";
  return overrides > 1 ? `every branch, ${overrides} with their own limits` : "every branch";
}
