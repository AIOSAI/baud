import { describe, expect, it } from "vitest";

import { CLEARED_KEY, bellMailView, readCleared, writeCleared } from "./bellMarks";

function store(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe("the bell's cleared mark", () => {
  it("is one machine-wide key, whatever the seat", () => {
    const marks = store();
    writeCleared(marks, "2026-10-21T02:00:00");
    expect(readCleared(marks, "BAUD")).toBe("2026-10-21T02:00:00");
    expect(readCleared(marks, "AIPASS")).toBe("2026-10-21T02:00:00");
    expect([...marks.items.keys()]).toEqual([CLEARED_KEY]);
  });

  it("adopts the seated project's old mark once, then the machine-wide key wins", () => {
    const marks = store({ "baud-bell-cleared:BAUD": "2026-10-20T10:00:00" });
    expect(readCleared(marks, "BAUD")).toBe("2026-10-20T10:00:00");
    expect(marks.items.get(CLEARED_KEY)).toBe("2026-10-20T10:00:00");
    writeCleared(marks, "2026-10-21T02:00:00");
    expect(readCleared(marks, "BAUD")).toBe("2026-10-21T02:00:00");
  });

  it("reads empty when nothing was ever cleared", () => {
    expect(readCleared(store(), "BAUD")).toBe("");
    expect(readCleared(store(), null)).toBe("");
  });
});

describe("bellMailView", () => {
  const mail = { ts: "t", kind: "mail", title: "x", body: "", source: "devpulse" };

  it("opens the message in the recipient's inbox, under the line's own project", () => {
    expect(bellMailView({ ...mail, mail_id: "bda4b06f", recipient: "api", project: "aipass" }, "BAUD")).toEqual({
      screen: "inbox",
      branch: "api",
      project: "aipass",
      openId: "bda4b06f",
    });
  });

  it("falls back to the seat when the line names no project", () => {
    expect(bellMailView({ ...mail, mail_id: "43a53d7b", recipient: "@daemon" }, "BAUD")).toEqual({
      screen: "inbox",
      branch: "daemon",
      project: "BAUD",
      openId: "43a53d7b",
    });
  });

  it("opens nothing without both the id and the recipient", () => {
    expect(bellMailView({ ...mail, mail_id: "bda4b06f" }, "BAUD")).toBeNull();
    expect(bellMailView({ ...mail, recipient: "api" }, "BAUD")).toBeNull();
    expect(bellMailView({ ...mail, mail_id: "bda4b06f", recipient: "api" }, null)).toBeNull();
  });
});
