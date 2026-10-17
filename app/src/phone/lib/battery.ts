/** The BAT card's face and sheet words; tone uses only the host's low/critical lines, never an invented scale. */

import type { MachineVitals } from "../../types";
import type { AppFace } from "../FleetWheel";

export type BatteryReading = NonNullable<MachineVitals["battery"]>;
export type BatteryTone = "normal" | "warm" | "hot";

/** The mains mark: a text glyph (U+21AF), not an emoji, so it takes the card's type and colour. */
export const ON_MAINS_MARK = "↯";

/** Said when the vitals carry no battery key (an older skill on schema 1): absent, never inferred. */
export const PREDATES_BATTERY = "the host's vitals predate the battery reading";

export function batteryFace(battery: BatteryReading | undefined): AppFace {
  if (!battery || !battery.available || battery.percent === null) {
    return { value: "—", absent: true, ring: "dead" };
  }
  const percent = Math.max(0, Math.min(100, battery.percent));
  return {
    value: String(Math.round(percent)),
    unit: battery.plugged === true ? `%${ON_MAINS_MARK}` : "%",
    absent: false,
    ring: { percent, tone: batteryTone(percent, battery.state, battery.low, battery.critical) },
  };
}

export function batteryTone(
  percent: number,
  state: BatteryReading["state"],
  low: number | null,
  critical: number | null,
): BatteryTone {
  if (state !== "discharging") return "normal";
  if (critical !== null && percent <= critical) return "hot";
  if (low !== null && percent <= low) return "warm";
  return "normal";
}

export function timeLeftText(secondsLeft: number | null, plugged: boolean | null): string {
  if (secondsLeft !== null && secondsLeft >= 0) {
    const minutes = Math.floor(secondsLeft / 60);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return plugged === true ? "on mains" : "unknown";
}
