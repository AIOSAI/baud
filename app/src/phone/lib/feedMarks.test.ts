import { describe, expect, it } from "vitest";

import { type MarkStore, legacyMarkKey, markKey, readMark, writeMark } from "./feedMarks";

/** A Storage stand-in: the two calls the markers use, over a plain map. */
function store(seed: Record<string, string> = {}): MarkStore & { held: Record<string, string> } {
  const held = { ...seed };
  return {
    held,
    getItem: (key) => (key in held ? held[key] : null),
    setItem: (key, value) => {
      held[key] = value;
    },
  };
}

describe("markKey", () => {
  it("names one key per marker with no project in it", () => {
    expect(markKey("read")).toBe("baud-phone-feed-read");
    expect(markKey("cleared")).toBe("baud-phone-feed-cleared");
  });
});

describe("legacyMarkKey", () => {
  it("names the per-project key the markers lived under before", () => {
    expect(legacyMarkKey("read", "aipass")).toBe("baud-phone-feed-read:aipass");
    expect(legacyMarkKey("cleared", "baud")).toBe("baud-phone-feed-cleared:baud");
  });
});

describe("readMark", () => {
  it("reads the machine-wide mark whichever project is seated", () => {
    const marks = store({ "baud-phone-feed-read": "2026-10-16T15:00:00" });
    expect(readMark(marks, "read", "aipass")).toBe("2026-10-16T15:00:00");
    expect(readMark(marks, "read", "baud")).toBe("2026-10-16T15:00:00");
  });

  it("lets the machine-wide mark win over a newer per-project one, so no seat brings the old split back", () => {
    const marks = store({
      "baud-phone-feed-read": "2026-10-16T15:00:00",
      "baud-phone-feed-read:baud": "2026-10-16T16:00:00",
    });
    expect(readMark(marks, "read", "baud")).toBe("2026-10-16T15:00:00");
    expect(marks.held["baud-phone-feed-read"]).toBe("2026-10-16T15:00:00");
  });

  it("lifts the seated project's old mark into the machine-wide key the first time", () => {
    const marks = store({ "baud-phone-feed-cleared:aipass": "2026-10-16T14:00:00" });
    expect(readMark(marks, "cleared", "aipass")).toBe("2026-10-16T14:00:00");
    expect(marks.held["baud-phone-feed-cleared"]).toBe("2026-10-16T14:00:00");
  });

  it("leaves the old per-project key in place after the lift", () => {
    const marks = store({ "baud-phone-feed-read:aipass": "2026-10-16T14:00:00" });
    readMark(marks, "read", "aipass");
    expect(marks.held["baud-phone-feed-read:aipass"]).toBe("2026-10-16T14:00:00");
  });

  it("lifts only the marker asked for, never the other one's old value", () => {
    const marks = store({ "baud-phone-feed-cleared:aipass": "2026-10-16T14:00:00" });
    expect(readMark(marks, "read", "aipass")).toBe("");
    expect(marks.held["baud-phone-feed-read"]).toBe(undefined);
  });

  it("does not lift another project's old mark", () => {
    const marks = store({ "baud-phone-feed-read:baud": "2026-10-16T14:00:00" });
    expect(readMark(marks, "read", "aipass")).toBe("");
    expect(marks.held["baud-phone-feed-read"]).toBe(undefined);
  });

  it("answers empty and writes nothing when there is no mark of either kind", () => {
    const marks = store();
    expect(readMark(marks, "read", "aipass")).toBe("");
    expect(marks.held).toEqual({});
  });

  it("does not lift an empty old mark, so a later seat with a real one still can", () => {
    const marks = store({ "baud-phone-feed-read:aipass": "" });
    expect(readMark(marks, "read", "aipass")).toBe("");
    expect(marks.held["baud-phone-feed-read"]).toBe(undefined);
  });

  it("answers empty and writes nothing with no seat to lift from", () => {
    const marks = store({ "baud-phone-feed-read:": "2026-10-16T14:00:00" });
    expect(readMark(marks, "read", "")).toBe("");
    expect(marks.held["baud-phone-feed-read"]).toBe(undefined);
  });

  it("keeps an empty machine-wide mark rather than lifting over it", () => {
    const marks = store({ "baud-phone-feed-read": "", "baud-phone-feed-read:aipass": "2026-10-16T14:00:00" });
    expect(readMark(marks, "read", "aipass")).toBe("");
  });
});

describe("writeMark", () => {
  it("writes the machine-wide key and no per-project one", () => {
    const marks = store();
    writeMark(marks, "cleared", "2026-10-16T16:05:00");
    expect(marks.held).toEqual({ "baud-phone-feed-cleared": "2026-10-16T16:05:00" });
  });

  it("is what a later read on another project sees", () => {
    const marks = store();
    writeMark(marks, "read", "2026-10-16T16:05:00");
    expect(readMark(marks, "read", "baud")).toBe("2026-10-16T16:05:00");
  });
});
