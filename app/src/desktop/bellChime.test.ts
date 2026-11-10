// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { chime } from "./Bell";
import type { WebglAddon } from "@xterm/addon-webgl";

import { paintWithWebgl } from "./Terminal";

/** Desktop hardware edges: the bell's audio context sleeps between chimes (Bell.tsx); the terminal's
 *  WebGL renderer fails out loud, never to the DOM renderer (Terminal.tsx). */

const calls: string[] = [];
const oscillators: { onended: (() => void) | null; at: number }[] = [];

class FakeContext {
  state = "suspended";
  // A suspended context's clock is frozen; it moves on when it wakes.
  currentTime = 5;
  destination = {};
  resume() {
    calls.push("resume");
    this.state = "running";
    this.currentTime = 9;
    return Promise.resolve();
  }
  suspend() {
    calls.push("suspend");
    this.state = "suspended";
    return Promise.resolve();
  }
  createGain() {
    const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    return { gain: param, connect: (next: unknown) => next };
  }
  createOscillator() {
    const osc = {
      type: "",
      frequency: { value: 0 },
      onended: null as (() => void) | null,
      at: -1,
      connect: (next: unknown) => next,
      start(at: number) {
        osc.at = at;
      },
      stop() {},
    };
    oscillators.push(osc);
    return osc;
  }
}

(window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const lastEnds = () => oscillators[oscillators.length - 1].onended!();

describe("the bell's chime", () => {
  it("wakes the context before scheduling its notes and suspends it when the last note ends", async () => {
    chime();
    await settle();
    expect(calls).toEqual(["resume"]);
    expect(oscillators.map((o) => o.at).every((at) => at >= 9)).toBe(true);
    lastEnds();
    await settle();
    expect(calls).toEqual(["resume", "suspend"]);
  });

  it("stays awake while a second chime still sounds", async () => {
    calls.length = 0;
    chime();
    await settle();
    const first = oscillators[oscillators.length - 1];
    chime();
    await settle();
    first.onended!();
    await settle();
    expect(calls).toEqual(["resume", "resume"]);
    lastEnds();
    await settle();
    expect(calls).toEqual(["resume", "resume", "suspend"]);
  });
});

describe("the terminal's WebGL paint", () => {
  it("reports a renderer that will not load, and loads nothing else", () => {
    const reasons: string[] = [];
    const loaded: unknown[] = [];
    const term = { loadAddon: (addon: unknown) => { loaded.push(addon); throw new Error("WebGL2 not supported"); } };
    expect(paintWithWebgl(term, (r) => reasons.push(r), () => ({ onContextLoss() {} }) as unknown as WebglAddon)).toBe(false);
    expect(reasons).toEqual(["the terminal's WebGL renderer did not load: WebGL2 not supported"]);
    expect(loaded).toHaveLength(1);
  });

  it("reports a lost context instead of switching renderer", () => {
    const reasons: string[] = [];
    let lose = () => {};
    const addon = { onContextLoss: (listener: () => void) => { lose = listener; } } as unknown as WebglAddon;
    const loaded: unknown[] = [];
    expect(paintWithWebgl({ loadAddon: (a: unknown) => loaded.push(a) }, (r) => reasons.push(r), () => addon)).toBe(true);
    expect(loaded).toEqual([addon]);
    expect(reasons).toEqual([]);
    lose();
    expect(reasons).toEqual(["the terminal's WebGL context was lost (GPU reset or suspend)"]);
  });
});
