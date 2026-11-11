import { describe, expect, it } from "vitest";

import { loudness, pcmSamples } from "./pcm";

describe("Piper PCM", () => {
  it("decodes signed 16-bit little-endian to -1..1", () => {
    const { samples, carry } = pcmSamples(null, new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x00, 0x40]));
    expect(Array.from(samples)).toEqual([0, 32767 / 32768, -1, 0.5]);
    expect(carry).toBeNull();
  });

  it("carries an odd byte into the next chunk", () => {
    const first = pcmSamples(null, new Uint8Array([0x00, 0x40, 0x00]));
    expect(Array.from(first.samples)).toEqual([0.5]);
    expect(Array.from(first.carry!)).toEqual([0x00]);
    const second = pcmSamples(first.carry, new Uint8Array([0xc0]));
    expect(Array.from(second.samples)).toEqual([-0.5]);
    expect(second.carry).toBeNull();
  });

  it("reads level from a frame, clamped to 1", () => {
    expect(loudness(new Float32Array(8))).toBe(0);
    expect(loudness(new Float32Array(8).fill(0.1))).toBeCloseTo(0.4);
    expect(loudness(new Float32Array(8).fill(1))).toBe(1);
  });
});
