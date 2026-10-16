/**
 * The second tap on `▸ resume ⚡` (DPLAN-0414 T4, A#12; owner 14:29).
 *
 * That door is an INTERCEPT: it stops a working agent before resuming its chat
 * (`rooms.ts`, the OSPREY ruling). Its warning lived only in a `title`, and a
 * touch screen never shows a title - so one tap stopped a running job with no
 * sentence ever seen. The owner's ruling: the sentence is shown, and the door
 * confirms on a second tap.
 *
 * THE SHAPE: the first tap ARMS the door and shows that it is armed; a second
 * tap within the window FIRES it. A tap after the window has passed arms it
 * again rather than firing - an arming that has gone stale is not consent. Any
 * other door disarms it (the card does that). The verb chips' own confirm is a
 * dialog with a cancel; a door that already opens a room wants the lighter
 * shape, so this is the two-tap the brief names for the case.
 *
 * PURE, and kept out of `rooms.ts` so it can be tested without loading the
 * desktop components that file re-exports from.
 */

/** How long an armed intercept waits for its second tap. */
export const INTERCEPT_WINDOW_MS = 4000;

/** What a tap on a door does: open it now, or arm it and wait. */
export type InterceptTap = "fire" | "arm";

/**
 * Decide a tap. `armedAt` is when the door was armed (ms), or null when it is
 * not. A door that is not an intercept always fires.
 */
export function interceptTap(intercept: boolean, armedAt: number | null, now: number): InterceptTap {
  if (!intercept) return "fire";
  if (armedAt === null) return "arm";
  const waited = now - armedAt;
  return waited >= 0 && waited <= INTERCEPT_WINDOW_MS ? "fire" : "arm";
}
