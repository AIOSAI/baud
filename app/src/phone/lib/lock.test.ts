import { describe, expect, it } from "vitest";

import type { LockState } from "../../types";
import { type LockFace, lockFace, lockLine } from "./lock";

/** A reading with every field null except the ones a case names. */
const reading = (over: Partial<LockState>): LockState => ({
  ok: true,
  locked: null,
  method: null,
  session: null,
  reason: null,
  detail: null,
  ...over,
});

describe("lockFace", () => {
  it("is unread before anything has answered (no state, no failure)", () => {
    expect(lockFace({ state: null, failure: null })).toBe("unread");
  });

  it("is unknown on a failure, even beside a reading that says unlocked", () => {
    expect(lockFace({ state: reading({ ok: true, locked: false }), failure: "host unreachable" })).toBe("unknown");
  });

  // Unknown is never unlocked: every shape a reading can take, and the one face
  // each may draw. Only ok: true with locked: false earns the green shackle.
  const shapes: Array<{ ok: boolean; locked: boolean | null; face: LockFace }> = [
    { ok: true, locked: true, face: "locked" },
    { ok: true, locked: false, face: "unlocked" },
    { ok: true, locked: null, face: "unknown" },
    { ok: false, locked: null, face: "unknown" },
    { ok: false, locked: true, face: "unknown" },
    { ok: false, locked: false, face: "unknown" },
  ];
  it.each(shapes)("ok: $ok with locked: $locked draws $face", ({ ok, locked, face }) => {
    expect(lockFace({ state: reading({ ok, locked }), failure: null })).toBe(face);
  });
});

describe("lockLine", () => {
  it("says nothing before any reading", () => {
    expect(lockLine({ state: null, failure: null })).toBeNull();
  });

  it("carries a failure in the host's own words", () => {
    expect(lockLine({ state: null, failure: "host unreachable" })).toBe("lock state unknown - host unreachable");
  });

  it("says the screen is locked for ok: true, locked: true", () => {
    expect(lockLine({ state: reading({ ok: true, locked: true }), failure: null })).toBe("the screen is locked");
  });

  it("says the screen is unlocked for ok: true, locked: false", () => {
    expect(lockLine({ state: reading({ ok: true, locked: false }), failure: null })).toBe("the screen is unlocked");
  });

  it("prefers the skill's own detail when it sent one", () => {
    const state = reading({ ok: false, reason: "no_session", detail: "no graphical session to ask" });
    expect(lockLine({ state, failure: null })).toBe("no graphical session to ask");
  });

  it("names the reason when the machine could not tell", () => {
    expect(lockLine({ state: reading({ ok: false, reason: "no_session" }), failure: null })).toBe(
      "lock state unknown (no_session)",
    );
  });

  it("is a plain unknown when the machine could not tell and gave no reason", () => {
    expect(lockLine({ state: reading({ ok: false }), failure: null })).toBe("lock state unknown");
  });
});
