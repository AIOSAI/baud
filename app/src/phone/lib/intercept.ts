/**
 * The second tap on `▸ resume ⚡`: the first tap arms the door, a second within
 * the window fires it; a stale arming re-arms rather than fires.
 * Reference: docs/phone/settings-nav.md
 */

/** How long an armed intercept waits for its second tap. */
export const INTERCEPT_WINDOW_MS = 4000;

/** What a tap on a door does: open it now, or arm it and wait. */
export type InterceptTap = "fire" | "arm";

/** Decide a tap; `armedAt` is ms or null, and a non-intercept door always fires. */
export function interceptTap(intercept: boolean, armedAt: number | null, now: number): InterceptTap {
  if (!intercept) return "fire";
  if (armedAt === null) return "arm";
  const waited = now - armedAt;
  return waited >= 0 && waited <= INTERCEPT_WINDOW_MS ? "fire" : "arm";
}
