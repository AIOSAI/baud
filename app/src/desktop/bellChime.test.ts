// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { chime } from "./Bell";

/** Tests for the bell's chime in src/desktop/Bell.tsx: the audio context sleeps between chimes. */

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
