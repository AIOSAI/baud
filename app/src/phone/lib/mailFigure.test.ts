import { describe, expect, it } from "vitest";

import { mailFigure } from "./mailFigure";

describe("mailFigure", () => {
  it("shows new and opened mail, new first", () => {
    expect(mailFigure(3, 1)).toBe("3 new · 1 opened");
  });

  it("keeps the opened half when it is zero", () => {
    expect(mailFigure(3, 0)).toBe("3 new · 0 opened");
  });

  it("keeps both halves when both are zero", () => {
    expect(mailFigure(0, 0)).toBe("0 new · 0 opened");
  });

  it("does not swap the halves", () => {
    expect(mailFigure(0, 7)).toBe("0 new · 7 opened");
  });
});
