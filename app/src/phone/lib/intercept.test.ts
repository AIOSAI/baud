import { describe, expect, it } from "vitest";

import { INTERCEPT_WINDOW_MS, interceptTap } from "./intercept";

describe("interceptTap", () => {
  it("fires a door that is not an intercept on the first tap", () => {
    expect(interceptTap(false, null, 1000)).toBe("fire");
  });

  it("arms an intercept on the first tap", () => {
    expect(interceptTap(true, null, 1000)).toBe("arm");
  });

  it("fires an armed intercept on a second tap inside the window", () => {
    expect(interceptTap(true, 1000, 2500)).toBe("fire");
  });

  it("fires on a second tap exactly at the window's edge", () => {
    expect(interceptTap(true, 1000, 1000 + INTERCEPT_WINDOW_MS)).toBe("fire");
  });

  it("arms again, never fires, when the second tap comes after the window", () => {
    expect(interceptTap(true, 1000, 1001 + INTERCEPT_WINDOW_MS)).toBe("arm");
  });

  it("arms again when the clock reads earlier than the arming", () => {
    expect(interceptTap(true, 5000, 4000)).toBe("arm");
  });

  it("waits four seconds", () => {
    expect(INTERCEPT_WINDOW_MS).toBe(4000);
  });
});
