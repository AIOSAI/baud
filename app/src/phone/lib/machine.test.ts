import { describe, expect, it } from "vitest";

import type { MachineVitals } from "../../types";
import { type MachineRead, bytesText, compact, machineFaces, rateParts, rateText, tempTone } from "./machine";

const up = { available: true, reason: null, sentence: null, detail: null };

/** A whole, healthy reading. Each case overrides only the section it is about. */
function vitals(over: Partial<MachineVitals> = {}): MachineVitals {
  return {
    ok: true,
    schema: 1,
    sampled_at: "2026-09-13T20:00:00-07:00",
    cpu: { ...up, percent: 12.4, window_s: 2, cores: [10, 14.8], logical: 2, physical: 1, mhz: 1100, mhz_max: 3300 },
    load: { ...up, one: 0.5, five: 0.4, fifteen: 0.3 },
    memory: { ...up, total_bytes: 8 * 1024 ** 3, used_bytes: 4 * 1024 ** 3, available_bytes: 4 * 1024 ** 3, percent: 50 },
    swap: { ...up, total_bytes: 0, used_bytes: 0, free_bytes: 0, percent: 0 },
    temp: { ...up, chip: "coretemp", label: "Package id 0", celsius: 55, high: 100, critical: 100, seen: null },
    fan: { ...up, label: "fan1", current: 2000, range: { min: 1000, max: 6000 }, percent_of_range: 20, fans: null, seen: null },
    network: { ...up, sent_bytes_per_s: 200, recv_bytes_per_s: 140, window_s: 2 },
    processes: { ...up, count: 412 },
    ...over,
  };
}

const live = (reading: MachineVitals): MachineRead => ({ reading, refusal: null });
const healthy = vitals();
const dash = { value: "—", absent: true };

describe("machineFaces", () => {
  it("draws nothing before the first answer of a visit (no reading, no refusal)", () => {
    expect(machineFaces({ reading: null, refusal: null })).toEqual({});
  });

  it("draws every card as a dash on a refusal, with a dead ring only on the five gauges", () => {
    const faces = machineFaces({ reading: null, refusal: { code: "switched_off", message: "the machine read is off" } });
    expect(faces).toEqual({
      "mon-cpu": { ...dash, ring: "dead" },
      "mon-mem": { ...dash, ring: "dead" },
      "mon-temp": { ...dash, ring: "dead" },
      "mon-fan": { ...dash, ring: "dead" },
      "mon-net": { ...dash, ring: "none" },
      "mon-proc": { ...dash, ring: "none" },
      "mon-bat": { ...dash, ring: "dead" },
    });
  });

  it("cpu: a percent of 12.4 reads 12 with a ring of 12.4", () => {
    expect(machineFaces(live(healthy))["mon-cpu"]).toEqual({
      value: "12",
      unit: "%",
      absent: false,
      ring: { percent: 12.4, tone: "normal" },
    });
  });

  it("cpu warming (available: false, percent: null) is a dash with a dead ring, never 0", () => {
    const warming = vitals({ cpu: { ...healthy.cpu, available: false, reason: "warming", percent: null, cores: null } });
    expect(machineFaces(live(warming))["mon-cpu"]).toEqual({ ...dash, ring: "dead" });
  });

  it("an unavailable section is a dash even when a percent rides along", () => {
    const stale = vitals({ cpu: { ...healthy.cpu, available: false, reason: "warming", percent: 30 } });
    expect(machineFaces(live(stale))["mon-cpu"]).toEqual({ ...dash, ring: "dead" });
  });

  it("memory: a null percent on an available section is a dash, never 0", () => {
    const nulled = vitals({ memory: { ...healthy.memory, percent: null } });
    expect(machineFaces(live(nulled))["mon-mem"]).toEqual({ ...dash, ring: "dead" });
  });

  it("a percent of 104 keeps its number while the ring stops at 100", () => {
    const over = vitals({ cpu: { ...healthy.cpu, percent: 104 } });
    expect(machineFaces(live(over))["mon-cpu"]).toMatchObject({ value: "104", ring: { percent: 100 } });
  });

  it("temp: 55 °C against a critical of 100 is a ring of 55", () => {
    const face = machineFaces(live(healthy))["mon-temp"];
    expect(face).toMatchObject({ value: "55", unit: "°C", absent: false, ring: { tone: "normal" } });
    // celsius / critical * 100 is float arithmetic: 55.00000000000001 is a ring of 55.
    expect(face.ring !== "none" && face.ring !== "dead" ? face.ring.percent : null).toBeCloseTo(55);
  });

  it("temp: a sensor with no critical gets the number and no ring", () => {
    const unscaled = vitals({ temp: { ...healthy.temp, high: null, critical: null } });
    expect(machineFaces(live(unscaled))["mon-temp"]).toEqual({ value: "55", unit: "°C", absent: false, ring: "none" });
  });

  it("temp: a critical of 0 is no scale either, so no ring", () => {
    const zero = vitals({ temp: { ...healthy.temp, critical: 0 } });
    expect(machineFaces(live(zero))["mon-temp"]).toMatchObject({ value: "55", ring: "none" });
  });

  it("temp: no celsius is a dash with a dead ring", () => {
    const blind = vitals({ temp: { ...healthy.temp, celsius: null } });
    expect(machineFaces(live(blind))["mon-temp"]).toEqual({ ...dash, ring: "dead" });
  });

  it("fan: percent_of_range 20 reads 20 with a ring of 20", () => {
    expect(machineFaces(live(healthy))["mon-fan"]).toEqual({
      value: "20",
      unit: "%",
      absent: false,
      ring: { percent: 20, tone: "normal" },
    });
  });

  it("fan: no_range with a real 3600 rpm draws 3.6k rpm and no ring", () => {
    const unranged = vitals({
      fan: { ...healthy.fan, available: false, reason: "no_range", current: 3600, range: null, percent_of_range: null },
    });
    expect(machineFaces(live(unranged))["mon-fan"]).toEqual({ value: "3.6k", unit: "rpm", absent: false, ring: "none" });
  });

  it("fan: no_range with no rpm is a dash with a dead ring", () => {
    const silent = vitals({
      fan: { ...healthy.fan, available: false, reason: "no_range", current: null, range: null, percent_of_range: null },
    });
    expect(machineFaces(live(silent))["mon-fan"]).toEqual({ ...dash, ring: "dead" });
  });

  it("network: 200 sent plus 140 received reads 340 B/s, with no ring", () => {
    expect(machineFaces(live(healthy))["mon-net"]).toEqual({ value: "340", unit: "B/s", absent: false, ring: "none" });
  });

  it("network: one direction missing is a dash with no ring, never a half sum", () => {
    const half = vitals({ network: { ...healthy.network, recv_bytes_per_s: null } });
    expect(machineFaces(live(half))["mon-net"]).toEqual({ ...dash, ring: "none" });
  });

  it("processes: a count of 412 reads 412, with no ring", () => {
    expect(machineFaces(live(healthy))["mon-proc"]).toEqual({ value: "412", absent: false, ring: "none" });
  });

  it("processes: a null count is a dash with no ring, never 0", () => {
    const uncounted = vitals({ processes: { ...healthy.processes, count: null } });
    expect(machineFaces(live(uncounted))["mon-proc"]).toEqual({ ...dash, ring: "none" });
  });
});

describe("tempTone", () => {
  it("is hot at the sensor's high line", () => {
    expect(tempTone(100, 100, 105)).toBe("hot");
  });

  it("is warm from 85% of high, and normal just below it", () => {
    expect(tempTone(85, 100, 105)).toBe("warm");
    expect(tempTone(84.9, 100, 105)).toBe("normal");
  });

  it("uses critical in high's place when the sensor publishes no high", () => {
    expect(tempTone(90, null, 100)).toBe("warm");
    expect(tempTone(100, null, 100)).toBe("hot");
  });

  it("is normal when the sensor publishes no line at all, however hot", () => {
    expect(tempTone(150, null, null)).toBe("normal");
  });
});

describe("compact", () => {
  it("prints a count under 1000 whole: 412", () => {
    expect(compact(412)).toBe("412");
  });

  it("prints thousands to one place below 9950: 1234 -> 1.2k, 9949 -> 9.9k", () => {
    expect(compact(1234)).toBe("1.2k");
    expect(compact(9949)).toBe("9.9k");
  });

  it("prints whole thousands from 9950, so 9999 never reads 10.0k", () => {
    expect(compact(9950)).toBe("10k");
    expect(compact(9999)).toBe("10k");
    expect(compact(12_345)).toBe("12k");
  });
});

describe("rateParts and rateText", () => {
  it("keeps bytes under 1000: 340 -> 340 B/s", () => {
    expect(rateParts(340)).toEqual(["340", "B/s"]);
    expect(rateText(340)).toBe("340 B/s");
  });

  it("steps up at 1000, not 1024, so 1010 reads 1.0 KB/s", () => {
    expect(rateParts(1010)).toEqual(["1.0", "KB/s"]);
  });

  it("gives one decimal under ten and whole numbers from ten", () => {
    expect(rateParts(1.4 * 1024 ** 2)).toEqual(["1.4", "MB/s"]);
    expect(rateParts(12 * 1024)).toEqual(["12", "KB/s"]);
  });

  it("reads a negative rate as 0 B/s", () => {
    expect(rateParts(-5)).toEqual(["0", "B/s"]);
  });

  it("stops at GB/s", () => {
    expect(rateParts(5000 * 1024 ** 3)).toEqual(["5000", "GB/s"]);
  });
});

describe("bytesText", () => {
  it("speaks whole MiB under a gibibyte: 512 MiB", () => {
    expect(bytesText(512 * 1024 ** 2)).toBe("512 MiB");
  });

  it("speaks GiB to one place from a gibibyte: 1.0 GiB, 1.5 GiB", () => {
    expect(bytesText(1024 ** 3)).toBe("1.0 GiB");
    expect(bytesText(1.5 * 1024 ** 3)).toBe("1.5 GiB");
  });
});
