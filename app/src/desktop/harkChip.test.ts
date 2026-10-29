import { describe, expect, it } from "vitest";

import { harkTitle, harkVerb } from "./harkChip";

describe("harkVerb", () => {
  it("stops a listening or muted mic, starts a stopped one, does nothing with no room", () => {
    expect(harkVerb("listening")).toBe("stop");
    expect(harkVerb("muted")).toBe("stop");
    expect(harkVerb("stopped")).toBe("on");
    expect(harkVerb("absent")).toBeNull();
  });
});

describe("harkTitle", () => {
  it("names the state, the time and the way back", () => {
    expect(harkTitle("listening", "20:51")).toContain("listening since 20:51");
    expect(harkTitle("muted", "20:51")).toContain("mic still held");
    expect(harkTitle("absent", "20:51")).toBe("no hark room - open with drone @hark standby");
  });
});
