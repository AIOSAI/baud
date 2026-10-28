import { describe, expect, it } from "vitest";

import { keyStep, wheelStep } from "./wheelInput";

describe("keyStep", () => {
  it("moves cards sideways, layers up and down, and opens on Enter", () => {
    expect(keyStep("ArrowLeft")).toEqual({ card: -1 });
    expect(keyStep("ArrowRight")).toEqual({ card: 1 });
    expect(keyStep("ArrowUp")).toEqual({ layer: -1 });
    expect(keyStep("ArrowDown")).toEqual({ layer: 1 });
    expect(keyStep("Enter")).toBe("open");
  });

  it("leaves every other key to the browser", () => {
    expect(keyStep("Tab")).toBeNull();
    expect(keyStep(" ")).toBeNull();
  });
});

describe("wheelStep", () => {
  it("turns a vertical wheel into a layer step, down is next", () => {
    expect(wheelStep({ deltaX: 0, deltaY: 100, shiftKey: false })).toEqual({ layer: 1 });
    expect(wheelStep({ deltaX: 3, deltaY: -40, shiftKey: false })).toEqual({ layer: -1 });
  });

  it("turns shift+wheel into a card step, on either axis the engine reports", () => {
    expect(wheelStep({ deltaX: 0, deltaY: 100, shiftKey: true })).toEqual({ card: 1 });
    expect(wheelStep({ deltaX: -100, deltaY: 0, shiftKey: true })).toEqual({ card: -1 });
  });

  it("leaves a sideways pan to the rail's native scroll", () => {
    expect(wheelStep({ deltaX: 50, deltaY: 10, shiftKey: false })).toBeNull();
    expect(wheelStep({ deltaX: 0, deltaY: 0, shiftKey: false })).toBeNull();
    expect(wheelStep({ deltaX: 0, deltaY: 0, shiftKey: true })).toBeNull();
  });
});
