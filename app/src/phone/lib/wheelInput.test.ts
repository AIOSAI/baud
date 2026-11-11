import { describe, expect, it } from "vitest";

import { gateTurn, keyStep, QUIET, WHEEL_SPEEDS, wheelSpeed, wheelStep } from "./wheelInput";

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

describe("wheelSpeed", () => {
  it("reads a stored level and falls back to normal", () => {
    expect(wheelSpeed("slow")).toBe("slow");
    expect(wheelSpeed("fast")).toBe("fast");
    expect(wheelSpeed(null)).toBe("normal");
    expect(wheelSpeed("warp")).toBe("normal");
    expect(wheelSpeed("toString")).toBe("normal");
  });
});

describe("gateTurn", () => {
  const run = (gate = WHEEL_SPEEDS.normal, events: [number, number][]) => {
    let held = QUIET;
    return events.map(([at, delta]) => {
      const next = gateTurn(held, at, delta, gate);
      held = next.gesture;
      return next.fire;
    });
  };

  it("steps once per gesture, however long the inertia stream runs", () => {
    expect(run(WHEEL_SPEEDS.normal, [[0, 100], [16, 100], [32, 100], [300, 80]])).toEqual([true, false, false, false]);
  });

  it("starts a new gesture after a quiet gap longer than the level's rest", () => {
    expect(run(WHEEL_SPEEDS.normal, [[0, 100], [351, 100]])).toEqual([true, true]);
    expect(run(WHEEL_SPEEDS.slow, [[0, 100], [351, 100]])).toEqual([true, false]);
  });

  it("waits for the turn to reach the level's delta, summed across the gesture", () => {
    expect(run(WHEEL_SPEEDS.slow, [[0, 20], [16, 20], [32, 25]])).toEqual([false, false, true]);
    expect(run(WHEEL_SPEEDS.fast, [[0, 1]])).toEqual([true]);
  });

  it("forgets a small turn once the gesture goes quiet", () => {
    expect(run(WHEEL_SPEEDS.slow, [[0, 40], [600, 40]])).toEqual([false, false]);
  });

  it("orders the levels slow to fast", () => {
    expect(WHEEL_SPEEDS.slow.restMs).toBeGreaterThan(WHEEL_SPEEDS.normal.restMs);
    expect(WHEEL_SPEEDS.normal.restMs).toBeGreaterThan(WHEEL_SPEEDS.fast.restMs);
  });
});
