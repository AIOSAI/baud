/**
 * The BAT card's face and the battery sheet's words (2026-10-12, the owner:
 * "add laptop battery status - ok go").
 *
 * Its own file rather than more of machine.ts because it is pure and pinned:
 * machine.ts carries the poll (react, the host transport), and a test of this
 * face should not have to stand any of that up. machine.ts calls `batteryFace`
 * from `machineFaces`, the same way it calls tempFace and fanFace.
 *
 * THE RING IS THE CHARGE, because 0-100 is the battery's own range - so this
 * card earns a ring where NET and PROC do not. THE TONE IS NEVER INVENTED: warm
 * and hot only while discharging, and only against a line the host PUBLISHED
 * (UPower's low and critical). No line, no colour - a threshold this face made
 * up would be an invented scale, the doctrine tempFace already follows.
 * PLUGGED IS A MARK, NEVER A COLOUR: the unit reads "%↯" on mains, so a charger
 * cannot be mistaken for a warning or for its absence.
 */

import type { MachineVitals } from "../../types";
import type { AppFace } from "../FleetWheel";

export type BatteryReading = NonNullable<MachineVitals["battery"]>;
export type BatteryTone = "normal" | "warm" | "hot";

/** The mains mark beside the percent: a text glyph (U+21AF), not an emoji, so
 *  it draws in the card's own type and colour. */
export const ON_MAINS_MARK = "↯";

/** What the sheet says when the host's vitals carry no battery key at all - an
 *  older skill answering schema 1. Absent, never inferred. */
export const PREDATES_BATTERY = "the host's vitals predate the battery reading";

/**
 * The BAT card's face.
 *
 * Args:
 *   battery: The section, or undefined when the host's vitals predate it.
 *
 * Returns:
 *   The dash and a dead ring when there is no charge to show; otherwise the
 *   rounded percent, the mains mark when plugged, and a ring of the charge.
 */
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

/**
 * Where a charge sits against the lines the host published.
 *
 * Args:
 *   percent: The charge.
 *   state: The section's state.
 *   low: The published low line, or null.
 *   critical: The published critical line, or null.
 */
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

/**
 * Time left as the sheet says it: h:mm from a real count, "on mains" when
 * plugged with no count, "unknown" otherwise.
 *
 * Args:
 *   secondsLeft: The section's seconds_left.
 *   plugged: The section's plugged.
 */
export function timeLeftText(secondsLeft: number | null, plugged: boolean | null): string {
  if (secondsLeft !== null && secondsLeft >= 0) {
    const minutes = Math.floor(secondsLeft / 60);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return plugged === true ? "on mains" : "unknown";
}
