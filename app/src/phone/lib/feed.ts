/** The feed's one merge rule, shared by the feed screen and the header badge. */

import type { NotificationEvent } from "../../types";

export const FEED_WINDOW = 100;

export const FEED_KEEP = 200;

/**
 * Fold a window in on ts/title: the server re-delivers the boundary event (at-least-once).
 * Newest first is a contract: the badge counts the head, so another order makes the cut drop it.
 */
export function mergeEvents(
  seen: NotificationEvent[],
  arriving: NotificationEvent[],
): NotificationEvent[] {
  const byKey = new Map(seen.map((event) => [`${event.ts}/${event.title}`, event]));
  arriving.forEach((event) => byKey.set(`${event.ts}/${event.title}`, event));
  return [...byKey.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, FEED_KEEP);
}
