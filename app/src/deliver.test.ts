import { describe, expect, it } from "vitest";

import { deliveryText } from "./deliver";

describe("deliveryText", () => {
  it("types nothing for no paths, not even the two spaces", () => {
    expect(deliveryText([])).toBe("");
  });

  it("leaves a plain path bare, wrapped in one space each side", () => {
    expect(deliveryText(["/tmp/shot.png"])).toBe(" /tmp/shot.png ");
  });

  it("joins several paths with one space", () => {
    expect(deliveryText(["/tmp/a.png", "/tmp/b.png"])).toBe(" /tmp/a.png /tmp/b.png ");
  });

  it("single-quotes a path with a space in it", () => {
    expect(deliveryText(["/tmp/my shot.png"])).toBe(" '/tmp/my shot.png' ");
  });

  it("quotes only the paths that need it", () => {
    expect(deliveryText(["/tmp/plain.png", "/tmp/my shot.png"])).toBe(" /tmp/plain.png '/tmp/my shot.png' ");
  });

  it("closes and reopens a single quote as '\\''", () => {
    expect(deliveryText(["/tmp/it's.png"])).toBe(" '/tmp/it'\\''s.png' ");
  });

  it("quotes a path with a double quote in it", () => {
    expect(deliveryText(['/tmp/say "hi".png'])).toBe(` '/tmp/say "hi".png' `);
  });

  it("counts a tab as whitespace", () => {
    expect(deliveryText(["/tmp/a\tb.png"])).toBe(" '/tmp/a\tb.png' ");
  });

  it("adds no newline of its own, so it never submits", () => {
    expect(deliveryText(["/tmp/a.png", "/tmp/my shot.png", "/tmp/it's.png"])).not.toMatch(/[\r\n]/);
  });
});
