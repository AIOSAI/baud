/**
 * WHAT A CLOSED SOCKET MEANS - for the room and the watch alike.
 *
 * The room lane read every close but two the same way: "detached, still
 * running", and the reconnect ladder started again. Three closes are not that,
 * and the reviewer traced each to the screen (B#4-B#6):
 *
 *  - 4000 "room ended" (C-C). @api's pump closes with it when the tmux session
 *    ended under the socket - from the desk, or a shell that exited. The room
 *    is GONE, and the attach is `new-session -A`, so reattaching would build a
 *    fresh empty room under the same name and call it the old one.
 *  - 1008 and 1011, sent AFTER accept so the sentence reaches the screen: the
 *    caller's fixable refusal and the host's. Asking again on a timer gets the
 *    same answer louder.
 *  - everything else (1000, 1001, 1005, 1006): a detach, a pocket, a dropped
 *    link. The room is fine, and the ladder is the right answer.
 *
 * So the first two are FINAL - no ladder - and each says what it is. PURE, so
 * the decisions are pinned by `socketClose.test.ts` with no socket, no xterm
 * and no react; `TerminalSheet.tsx` and `MonitorSheet.tsx` only act on them.
 */

/** @api's close code for "the room ended first" (C-C). Private-use range, so
 *  no proxy or framework rewrites it on the way to `CloseEvent.code`. */
export const ROOM_ENDED_CODE = 4000;

/** The three readings of a close. */
export type CloseKind = "ended" | "refused" | "dropped";

/** What a close code is. */
export function closeKind(code: number): CloseKind {
  if (code === ROOM_ENDED_CODE) return "ended";
  if (code === 1008 || code === 1011) return "refused";
  return "dropped";
}

/** Does this close stop the reconnect ladder? Null is "no close yet". */
export function closeIsFinal(kind: CloseKind | null): boolean {
  return kind === "ended" || kind === "refused";
}

/**
 * The error line after a close (B#4).
 *
 * A token refused at the handshake never reaches `onopen`: the browser reports
 * 1006, `onerror` has already written the one sentence that can be said about
 * it, and the close's own sentence is null. Overwriting with that null is how
 * "the token was rejected" became "the room did not answer". So a close with
 * nothing to say, on a socket that never opened, keeps what was there.
 */
export function errorAfterClose(previous: string | null, said: string | null, reachedOpen: boolean): string | null {
  if (said === null && !reachedOpen) return previous;
  return said;
}

/** The room's status line after a close. `watchdog` is the phone's own
 *  sentence when its liveness check was the one that let go. */
export function roomStatusAfterClose(kind: CloseKind, watchdog: string | null): string {
  if (kind === "ended") return "ended - this room is gone";
  if (kind === "refused") return "refused - the host would not open this room";
  return watchdog ?? "detached - the room and whatever runs in it are still there";
}

/** What a watch is called on its overlay and its button: mission control has
 *  no name (it is the target-less monitor), every other watch is its branch. */
export function watchLabel(name: string): string {
  return name ? name : "mission control";
}

/** The dead overlay's words. `retry` null means no button (an ended room is
 *  reopened from its card, never from here); `ladder` null means no line. */
export interface DeadFace {
  word: string;
  why: string;
  retry: string | null;
  ladder: string | null;
}

/**
 * The overlay a sheet draws over its stale frame, or null for none. The
 * caller has already ruled out a live socket and a read-token refusal.
 *
 * THE ROOM keeps its old gate for a plain drop: hidden while it is still
 * getting in for the first time and a retry is armed, and otherwise shown.
 * THE WATCH shows nothing until a socket has actually CLOSED (B#9): `closed`
 * null there is the first connect, and a "rewatch" button over a watch that is
 * still connecting reads as a failure that has not happened.
 */
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
