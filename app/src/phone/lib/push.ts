/**
 * Push hook points - declared, exported, and inert
 * (FPLAN-0413, reservation for phase 7).
 *
 * The bell works while the face is open: it polls `/v1/feed` with the cursor
 * discipline the desktop already uses. What it cannot do is ring when the
 * phone is in a pocket, and that needs a push service (ntfy or equivalent)
 * that nobody has provisioned yet.
 *
 * Rather than leave the shell with nowhere to grow, the two moments push cares
 * about are named here and do nothing:
 *
 *   - enrollment: the face learns a push destination and tells the server
 *   - delivery:   a pushed event arrives and the feed must not double-count it
 *
 * The second is the reason this is a reservation and not a stub to be written
 * later off the cuff. `/v1/feed` re-delivers the boundary event on purpose -
 * at-least-once, because a dropped alert is worse than a duplicate. A push
 * channel arriving beside that cursor is a SECOND delivery path, and the day
 * it lands the dedupe has to be designed with the cursor, not bolted next to
 * it. Writing that down now costs nothing; discovering it live costs an
 * evening.
 */

import type { NotificationEvent } from "../../types";

/** Where a pushed event would arrive from, once one can. */
export type PushDestination = { kind: "ntfy"; topic: string } | { kind: "none" };

/** No destination today. */
export function pushDestination(): PushDestination {
  return { kind: "none" };
}

/** Enrollment hook. Inert: there is no push service to enroll with. */
export async function enrollPush(): Promise<PushDestination> {
  return { kind: "none" };
}

/**
 * Delivery hook. Inert, and if it ever stops being inert it must reconcile
 * against the feed cursor rather than append - see the note above.
 */
export function onPushedEvent(_event: NotificationEvent): void {
  /* no push channel exists yet */
}
