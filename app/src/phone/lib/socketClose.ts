/** What a closed socket means, for room and watch: 4000 (ended) and 1008/1011 (refused) are final, the rest retry.
 * Reattaching after 4000 would build a fresh empty room under the old name. Reference: docs/phone/room-delivery.md */

/** @api's "the room ended first" code; private-use range, so no proxy rewrites it. */
export const ROOM_ENDED_CODE = 4000;

export type CloseKind = "ended" | "refused" | "dropped";

export function closeKind(code: number): CloseKind {
  if (code === ROOM_ENDED_CODE) return "ended";
  if (code === 1008 || code === 1011) return "refused";
  return "dropped";
}

export function closeIsFinal(kind: CloseKind | null): boolean {
  return kind === "ended" || kind === "refused";
}

/** The error line after a close: a silent close before open keeps what `onerror` wrote (a refusal closes 1006). */
export function errorAfterClose(previous: string | null, said: string | null, reachedOpen: boolean): string | null {
  if (said === null && !reachedOpen) return previous;
  return said;
}

/** The room's status line after a close; `watchdog` is the liveness check's own sentence. */
export function roomStatusAfterClose(kind: CloseKind, watchdog: string | null): string {
  if (kind === "ended") return "ended - this room is gone";
  if (kind === "refused") return "refused - the host would not open this room";
  return watchdog ?? "detached - the room and whatever runs in it are still there";
}

/** A watch's name on its overlay: the target-less monitor is mission control. */
export function watchLabel(name: string): string {
  return name ? name : "mission control";
}

/** The dead overlay's words; `retry` null means no button (an ended room reopens from its card). */
export interface DeadFace {
  word: string;
  why: string;
  retry: string | null;
  ladder: string | null;
}

/** The overlay over a stale frame, or null; a watch shows nothing until a socket has closed (null is its first connect). */
export function deadFace({
  lane,
  label,
  closed,
  opened,
  reconnecting,
}: {
  lane: "room" | "watch";
  label: string;
  closed: CloseKind | null;
  opened: boolean;
  reconnecting: boolean;
}): DeadFace | null {
  if (lane === "watch" && closed === null) return null;
  const retry = lane === "room" ? `reattach to ${label}` : `rewatch ${label}`;
  if (closed === "ended") {
    return lane === "room"
      ? { word: "ended", why: "this room is gone; open it again from the card to start fresh", retry: null, ladder: null }
      : { word: "ended", why: "the watch ended", retry, ladder: null };
  }
  if (closed === "refused") {
    return {
      word: "refused",
      why: `the host refused ${label} - its reason is above.`,
      retry,
      ladder: "not trying again by itself - a refusal gets the same answer. Tap to try again.",
    };
  }
  if (!opened && reconnecting) return null;
  const ladder = reconnecting
    ? "trying again by itself while this screen is open"
    : `not trying any more - the ${lane} did not answer. Tap to try again.`;
  if (lane === "room") {
    return {
      word: opened ? "detached" : "not attached",
      why: opened
        ? `${label} is still running. This is the last frame the phone was sent, not the room now.`
        : `the phone has not got into ${label}.`,
      retry: reconnecting ? "reattaching…" : retry,
      ladder,
    };
  }
  return {
    word: opened ? "dropped" : "not watching",
    why: opened
      ? `the watch on ${label} dropped. This is the last frame it sent, not ${label} now.`
      : `the phone has not got into the watch on ${label}.`,
    retry: reconnecting ? "rewatching…" : retry,
    ladder,
  };
}
