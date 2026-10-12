import { describe, expect, it } from "vitest";

import { type BatteryReading, PREDATES_BATTERY, batteryFace, batteryTone, timeLeftText } from "./battery";

const up = { available: true, reason: null, sentence: null, detail: null };

/** The owner's laptop at 14:55: plugged, full, no UPower lines read. */
function battery(over: Partial<BatteryReading> = {}): BatteryReading {
  return { ...up, percent: 100, plugged: true, state: "full", seconds_left: null, low: null, critical: null, ...over };
}

describe("batteryFace", () => {
  it("plugged and full reads 100 with the mains mark and a normal ring of 100", () => {
    expect(batteryFace(battery())).toEqual({
      value: "100",
      unit: "%↯",
      absent: false,
      ring: { percent: 100, tone: "normal" },
    });
  });

  it("discharging at 42 with no published lines is a plain percent and a normal ring", () => {
    const face = batteryFace(battery({ plugged: false, state: "discharging", percent: 42.4, seconds_left: 5400 }));
    expect(face).toEqual({ value: "42", unit: "%", absent: false, ring: { percent: 42.4, tone: "normal" } });
  });

  it("discharging at the published low line is warm, and at critical is hot", () => {
    const lines = { plugged: false, state: "discharging" as const, low: 20, critical: 5 };
    expect(batteryFace(battery({ ...lines, percent: 20 })).ring).toEqual({ percent: 20, tone: "warm" });
    expect(batteryFace(battery({ ...lines, percent: 5 })).ring).toEqual({ percent: 5, tone: "hot" });
  });

  it("a section that is not available is the dash and a dead ring, never 0", () => {
    const gone = battery({ available: false, reason: "no_sensor", percent: null, plugged: null, state: "unknown" });
    expect(batteryFace(gone)).toEqual({ value: "—", absent: true, ring: "dead" });
  });

  it("an unavailable section is the dash even when a percent rides along", () => {
    expect(batteryFace(battery({ available: false, reason: "read_failed", percent: 50 }))).toEqual({
      value: "—",
      absent: true,
      ring: "dead",
    });
  });

  it("an available section with a null percent is the dash, even when plugged", () => {
    expect(batteryFace(battery({ percent: null }))).toEqual({ value: "—", absent: true, ring: "dead" });
  });

  it("vitals with no battery key at all draw absent rather than guess a battery", () => {
    expect(batteryFace(undefined)).toEqual({ value: "—", absent: true, ring: "dead" });
    expect(PREDATES_BATTERY).toBe("the host's vitals predate the battery reading");
  });

  it("an over-range percent keeps the ring at 100 and the face at 100", () => {
    expect(batteryFace(battery({ percent: 103 }))).toMatchObject({ value: "100", ring: { percent: 100 } });
  });
});

describe("batteryTone", () => {
  it("never tones a battery that is charging or full, however low", () => {
    expect(batteryTone(3, "charging", 20, 5)).toBe("normal");
    expect(batteryTone(3, "full", 20, 5)).toBe("normal");
  });

  it("is warm just at the low line and normal just above it", () => {
    expect(batteryTone(20, "discharging", 20, 5)).toBe("warm");
    expect(batteryTone(20.1, "discharging", 20, 5)).toBe("normal");
  });

  it("with only a critical line published, is hot at it and normal above, never warm", () => {
    expect(batteryTone(5, "discharging", null, 5)).toBe("hot");
    expect(batteryTone(15, "discharging", null, 5)).toBe("normal");
  });

  it("is normal while discharging when the host published no line at all", () => {
    expect(batteryTone(1, "discharging", null, null)).toBe("normal");
  });
});

describe("timeLeftText", () => {
  it("renders a count as h:mm with the minutes padded: 5400 s -> 1:30, 3660 s -> 1:01", () => {
    expect(timeLeftText(5400, false)).toBe("1:30");
    expect(timeLeftText(3660, false)).toBe("1:01");
  });

  it("drops the seconds rather than rounding them up: 179 s -> 0:02", () => {
    expect(timeLeftText(179, false)).toBe("0:02");
  });

  it("says on mains with no count while plugged, and unknown otherwise", () => {
    expect(timeLeftText(null, true)).toBe("on mains");
    expect(timeLeftText(null, false)).toBe("unknown");
    expect(timeLeftText(null, null)).toBe("unknown");
  });
});
