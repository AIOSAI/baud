/**
 * One feed, one merge rule (DPLAN-0305).
 *
 * The feed is read in two places on this face: the screen that lists it, and
 * the badge on the header that counts it. They were reading it two different
 * WAYS - the screen with a cursor and a merge, the badge by refetching the
 * whole window every ten seconds - and the screen's own doc already said why
 * that is wrong: "a badge counting three events over a screen that shows none
 * is the phone telling two stories about one feed."
 *
 * So the cursor discipline moved here, where both can take it. This module is
 * the ONLY place that decides what a window is worth, how long the reader
 * keeps events, and how an arriving window folds into the ones already held.
 *
 * WHY A MERGE AT ALL, kept from the screen that wrote it: the server
 * re-delivers the boundary event on purpose - at-least-once, because a dropped
 * alert is worse than a duplicate - so a window is folded on its identity
 * rather than appended blindly.
 */

import type { NotificationEvent } from "../../types";

/** One window's worth. The server clamps its own maximum on top of this. */
export const FEED_WINDOW = 100;

/** Reader-side retention, matching the desktop bell's default. */
export const FEED_KEEP = 200;

/**
 * Fold an arriving window into what the reader already holds.
 *
 * KEYED ON TIMESTAMP AND TITLE, not on the object: an event that arrives twice
 * is the boundary being re-delivered, not two things happening, and appending
 * it would show the operator a double and count it twice on the badge.
 *
 * NEWEST FIRST, then cut to the retention limit. The order is the feed's own
 * and both readers depend on it - the screen renders down the list, and the
 * badge counts a HEAD (everything newer than the read marker), so a list
 * sorted the other way would make the cut throw away the very events the badge
 * exists to count.
 *
 * Args:
 *   seen: What the reader holds, newest first.
 *   arriving: The window the server just answered with.
 *
 * Returns:
 *   The two folded together, newest first, no longer than `FEED_KEEP`.
 */
export function mergeEvents(
  seen: NotificationEvent[],
  arriving: NotificationEvent[],
): NotificationEvent[] {
  const byKey = new Map(seen.map((event) => [`${event.ts}/${event.title}`, event]));
  arriving.forEach((event) => byKey.set(`${event.ts}/${event.title}`, event));
  return [...byKey.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, FEED_KEEP);
}
