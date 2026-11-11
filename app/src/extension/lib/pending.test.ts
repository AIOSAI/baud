import { describe, expect, it } from "vitest";

import type { AgentLine } from "../../types";
import { PENDING_MS, add, canResend, discard, failed, lookOf, resent, settle, type Pending } from "./pending";

const at = Date.parse("2026-11-05T10:00:00Z");
const p = (id: number, sent: string, over: Partial<Pending> = {}): Pending => ({ id, sent, shown: sent, at, failed: null, ...over });
const user = (text: string, time: number): AgentLine => ({ n: 1, role: "user", text, time: new Date(time).toISOString() });

describe("pending sends", () => {
  it("waits, goes stale after 90 s, and offers resend only then", () => {
    expect(lookOf(p(1, "hi"), at + 1000)).toBe("waiting");
    expect(canResend(p(1, "hi"), at + 1000)).toBe(false);
    expect(lookOf(p(1, "hi"), at + PENDING_MS + 1)).toBe("stale");
    expect(canResend(p(1, "hi"), at + PENDING_MS + 1)).toBe(true);
  });

  it("a failed send (409, network) is pending at once with the host's words", () => {
    const list = failed(add([], p(1, "hi")), 1, "no room for aipass/api");
    expect(lookOf(list[0], at)).toBe("failed");
    expect(list[0].failed).toBe("no room for aipass/api");
    expect(canResend(list[0], at)).toBe(true);
  });

  it("resends exactly what was first sent, attachment paths and tag included", () => {
    const sent = "[Looking at: x · Docs (https://d)]\nsee /up/a.png";
    const list = resent(failed([p(1, sent, { shown: "see [Image #1]" })], 1, "409"), 1, at + 5000);
    expect(list[0]).toMatchObject({ sent, failed: null, at: at + 5000 });
  });

  it("drops a delivered send when its words show as a user line, not an older one", () => {
    const list = [p(1, "hello   there agent"), p(2, "second")];
    expect(settle(list, [user("hello there agent", at + 2000)]).map((x) => x.id)).toEqual([2]);
    expect(settle(list, [user("hello there agent", at - 60_000)]).map((x) => x.id)).toEqual([1, 2]);
    expect(settle(list, [{ ...user("second", at), role: "agent" }]).map((x) => x.id)).toEqual([1, 2]);
  });

  it("keeps a failed send even if the same words show up", () => {
    expect(settle(failed([p(1, "hi")], 1, "x"), [user("hi", at)])).toHaveLength(1);
  });

  it("discards one", () => {
    expect(discard([p(1, "a"), p(2, "b")], 1).map((x) => x.id)).toEqual([2]);
  });
});
