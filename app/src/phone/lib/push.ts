/**
 * Push hook points, declared and inert until a push service exists.
 * Trap: `/v1/feed` re-delivers its boundary event (at-least-once), so push is a second path needing cursor-aware dedupe.
 */

import type { NotificationEvent } from "../../types";

/** Where a pushed event would arrive from, once one can. */
export type PushDestination = { kind: "ntfy"; topic: string } | { kind: "none" };

export function pushDestination(): PushDestination {
  return { kind: "none" };
}

/** Enrollment hook. Inert: there is no push service to enroll with. */
export async function enrollPush(): Promise<PushDestination> {
  return { kind: "none" };
}

/** Delivery hook; once live it must reconcile against the feed cursor, never append. */
export function onPushedEvent(_event: NotificationEvent): void {
  /* no push channel exists yet */
}
