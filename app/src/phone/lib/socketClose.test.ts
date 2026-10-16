import { describe, expect, it } from "vitest";

import {
  ROOM_ENDED_CODE,
  closeIsFinal,
  closeKind,
  deadFace,
  errorAfterClose,
  roomStatusAfterClose,
  watchLabel,
} from "./socketClose";

describe("closeKind", () => {
  it("reads 4000 as the room ended (contract C-C)", () => {
    expect(ROOM_ENDED_CODE).toBe(4000);
    expect(closeKind(4000)).toBe("ended");
  });

  it("reads 1008 and 1011 as a refusal", () => {
    expect(closeKind(1008)).toBe("refused");
    expect(closeKind(1011)).toBe("refused");
  });

  it("reads every other close as a drop", () => {
    for (const code of [1000, 1001, 1005, 1006, 4001]) expect(closeKind(code)).toBe("dropped");
  });
});

describe("closeIsFinal", () => {
  it("stops the ladder on ended and refused only", () => {
    expect(closeIsFinal("ended")).toBe(true);
    expect(closeIsFinal("refused")).toBe(true);
    expect(closeIsFinal("dropped")).toBe(false);
    expect(closeIsFinal(null)).toBe(false);
  });
});

describe("errorAfterClose", () => {
  const token = "the room refused this connection - the token was rejected, or the host is unreachable";

  it("keeps the handshake sentence when a never-opened socket closes with nothing to say (B#4)", () => {
    expect(errorAfterClose(token, null, false)).toBe(token);
  });

  it("clears the line when an opened socket drops with nothing to say", () => {
    expect(errorAfterClose("old", null, true)).toBe(null);
  });

  it("shows the server's sentence over whatever was there", () => {
    expect(errorAfterClose(token, "no branch named 'x'", false)).toBe("no branch named 'x'");
    expect(errorAfterClose(null, "no branch named 'x'", true)).toBe("no branch named 'x'");
  });
});

describe("roomStatusAfterClose", () => {
  it("never says still running for an ended or refused room", () => {
    expect(roomStatusAfterClose("ended", null)).toBe("ended - this room is gone");
    expect(roomStatusAfterClose("refused", null)).toBe("refused - the host would not open this room");
  });

  it("says detached for a drop, and the watchdog's own sentence when it let go", () => {
    expect(roomStatusAfterClose("dropped", null)).toBe("detached - the room and whatever runs in it are still there");
    expect(roomStatusAfterClose("dropped", "dog")).toBe("dog");
  });

  it("an ended room outranks the watchdog's sentence", () => {
    expect(roomStatusAfterClose("ended", "dog")).toBe("ended - this room is gone");
  });
});

describe("watchLabel", () => {
  it("names the target-less monitor mission control, and any other watch by its branch", () => {
    expect(watchLabel("")).toBe("mission control");
    expect(watchLabel("devpulse")).toBe("devpulse");
  });
});

describe("deadFace, the room", () => {
  const room = { lane: "room" as const, label: "devpulse" };

  it("an ended room says so, offers no reattach, and runs no ladder (C-C)", () => {
    expect(deadFace({ ...room, closed: "ended", opened: true, reconnecting: false })).toEqual({
      word: "ended",
      why: "this room is gone; open it again from the card to start fresh",
      retry: null,
      ladder: null,
    });
  });

  it("a refused room says refused, not detached, and keeps a hand's retry (B#5)", () => {
    expect(deadFace({ ...room, closed: "refused", opened: true, reconnecting: false })).toEqual({
      word: "refused",
      why: "the host refused devpulse - its reason is above.",
      retry: "reattach to devpulse",
      ladder: "not trying again by itself - a refusal gets the same answer. Tap to try again.",
    });
  });

  it("a refused room is shown even before it ever opened", () => {
    expect(deadFace({ ...room, closed: "refused", opened: false, reconnecting: true })?.word).toBe("refused");
  });

  it("a dropped room that was attached is detached and still running, with the ladder armed", () => {
    expect(deadFace({ ...room, closed: "dropped", opened: true, reconnecting: true })).toEqual({
      word: "detached",
      why: "devpulse is still running. This is the last frame the phone was sent, not the room now.",
      retry: "reattaching…",
      ladder: "trying again by itself while this screen is open",
    });
  });

  it("a room still getting in for the first time shows nothing", () => {
    expect(deadFace({ ...room, closed: "dropped", opened: false, reconnecting: true })).toBe(null);
    expect(deadFace({ ...room, closed: null, opened: false, reconnecting: true })).toBe(null);
  });

  it("a room that never got in and stopped trying says so", () => {
    expect(deadFace({ ...room, closed: "dropped", opened: false, reconnecting: false })).toEqual({
      word: "not attached",
      why: "the phone has not got into devpulse.",
      retry: "reattach to devpulse",
      ladder: "not trying any more - the room did not answer. Tap to try again.",
    });
  });

  it("keeps the room's old gate when no close has happened yet", () => {
    expect(deadFace({ ...room, closed: null, opened: false, reconnecting: false })?.word).toBe("not attached");
  });
});

describe("deadFace, the watch", () => {
  const watch = { lane: "watch" as const, label: "mission control" };

  it("shows nothing before a close, connecting or not (B#9)", () => {
    expect(deadFace({ ...watch, closed: null, opened: false, reconnecting: false })).toBe(null);
    expect(deadFace({ ...watch, closed: null, opened: true, reconnecting: false })).toBe(null);
  });

  it("an ended watch says the watch ended, offers a rewatch, and does not re-arm (C-C)", () => {
    expect(deadFace({ ...watch, closed: "ended", opened: true, reconnecting: false })).toEqual({
      word: "ended",
      why: "the watch ended",
      retry: "rewatch mission control",
      ladder: null,
    });
  });

  it("a dropped watch is marked dead over its last frame, with the room's ladder (B#10)", () => {
    expect(deadFace({ ...watch, closed: "dropped", opened: true, reconnecting: false })).toEqual({
      word: "dropped",
      why: "the watch on mission control dropped. This is the last frame it sent, not mission control now.",
      retry: "rewatch mission control",
      ladder: "not trying any more - the watch did not answer. Tap to try again.",
    });
    expect(deadFace({ ...watch, closed: "dropped", opened: true, reconnecting: true })?.retry).toBe("rewatching…");
  });

  it("a watch that never got in and stopped trying says not watching", () => {
    expect(deadFace({ ...watch, closed: "dropped", opened: false, reconnecting: false })).toEqual({
      word: "not watching",
      why: "the phone has not got into the watch on mission control.",
      retry: "rewatch mission control",
      ladder: "not trying any more - the watch did not answer. Tap to try again.",
    });
  });

  it("a refused watch names its button by the watch", () => {
    expect(deadFace({ lane: "watch", label: "devpulse", closed: "refused", opened: true, reconnecting: false })?.retry).toBe(
      "rewatch devpulse",
    );
  });
});
