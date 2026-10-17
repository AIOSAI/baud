import { describe, expect, it } from "vitest";

import { GUARD_STATE, type HistoryLike, createBackRegistry, createHistoryGuard } from "./systemBack";

/** A History stand-in that records what the guard asked of it. */
function history(): HistoryLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    pushState: (data: unknown) => {
      calls.push(data === GUARD_STATE ? "push" : "push?");
    },
    back: () => {
      calls.push("back");
    },
  };
}

describe("createBackRegistry", () => {
  it("answers the newest registered handler, and the one under it once that leaves", () => {
    const registry = createBackRegistry();
    const ran: string[] = [];
    registry.add(() => ran.push("card"));
    const off = registry.add(() => ran.push("memory"));
    expect(registry.depth()).toBe(2);
    registry.top()?.();
    off();
    registry.top()?.();
    expect(ran).toEqual(["memory", "card"]);
    expect(registry.depth()).toBe(1);
  });

  it("answers nothing when nothing is open", () => {
    expect(createBackRegistry().top()).toBe(null);
  });

  it("removes only the handler it was asked to, and only once", () => {
    const registry = createBackRegistry();
    const ran: string[] = [];
    const offA = registry.add(() => ran.push("a"));
    registry.add(() => ran.push("b"));
    offA();
    offA();
    expect(registry.depth()).toBe(1);
    registry.top()?.();
    expect(ran).toEqual(["b"]);
  });

  it("tells its listeners on every add and remove, and stops when asked", () => {
    const registry = createBackRegistry();
    let told = 0;
    const stop = registry.subscribe(() => {
      told += 1;
    });
    const off = registry.add(() => undefined);
    off();
    expect(told).toBe(2);
    stop();
    registry.add(() => undefined);
    expect(told).toBe(2);
  });
});

describe("createHistoryGuard", () => {
  it("pushes one entry when a screen opens and none at rest", () => {
    const registry = createBackRegistry();
    const past = history();
    const guard = createHistoryGuard(past, registry);
    guard.sync();
    expect(past.calls).toEqual([]);
    registry.add(() => undefined);
    guard.sync();
    registry.add(() => undefined);
    guard.sync();
    expect(past.calls).toEqual(["push"]);
    expect(guard.armed()).toBe(true);
  });

  it("runs the top screen's back on the system Back, and re-arms while something is still open", () => {
    const registry = createBackRegistry();
    const past = history();
    const guard = createHistoryGuard(past, registry);
    const ran: string[] = [];
    registry.add(() => ran.push("card"));
    registry.add(() => ran.push("memory"));
    guard.sync();
    guard.popped();
    expect(ran).toEqual(["memory"]);
    expect(guard.armed()).toBe(false);
    guard.sync();
    expect(past.calls).toEqual(["push", "push"]);
  });

  it("takes its entry back off when the face comes to rest by a tap, and swallows that pop", () => {
    const registry = createBackRegistry();
    const past = history();
    const guard = createHistoryGuard(past, registry);
    const ran: string[] = [];
    const off = registry.add(() => ran.push("feed"));
    guard.sync();
    off();
    guard.sync();
    expect(past.calls).toEqual(["push", "back"]);
    expect(guard.armed()).toBe(false);
    registry.add(() => ran.push("roster"));
    guard.popped();
    expect(ran).toEqual([]);
    // The next pop is the operator's, and it runs.
    guard.popped();
    expect(ran).toEqual(["roster"]);
  });

  it("leaves the Back key to the browser at rest", () => {
    const registry = createBackRegistry();
    const past = history();
    const guard = createHistoryGuard(past, registry);
    guard.popped();
    guard.sync();
    expect(past.calls).toEqual([]);
  });
});
