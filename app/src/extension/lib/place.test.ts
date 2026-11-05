import { describe, expect, it } from "vitest";

import { clampPlace, placeKey } from "./place";

describe("orb place", () => {
  it("keys one place per site", () => {
    expect(placeKey("https://a.com")).toBe("overlay:https://a.com");
    expect(placeKey("https://a.com")).not.toBe(placeKey("https://b.com"));
  });

  it("clamps into a smaller window", () => {
    const box = { width: 140, height: 160 };
    expect(clampPlace({ left: 1800, top: 900 }, { width: 1000, height: 700 }, box)).toEqual({ left: 860, top: 540 });
    expect(clampPlace({ left: -50, top: -1 }, { width: 1000, height: 700 }, box)).toEqual({ left: 0, top: 0 });
    expect(clampPlace({ left: 100, top: 100 }, { width: 1000, height: 700 }, box)).toEqual({ left: 100, top: 100 });
    expect(clampPlace({ left: NaN, top: 5 }, { width: 100, height: 100 }, box)).toEqual({ left: 0, top: 0 });
  });
});
