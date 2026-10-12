/**
 * THE MACHINE LANE - the monitor layer's one read, and what its cards draw from
 * it (FPLAN-0561 row 3, every clause ruled in DPLAN-0341).
 *
 * WHAT IS MEASURED. `GET /v1/machine` is @skills' `machine_vitals()` relayed
 * verbatim by @api: cpu, load, memory, swap, temp, fan, network, processes and,
 * from schema 2 (2026-10-12), battery - optional on the type, since an older
 * skill omits the key - each carrying `available` / `reason` / `sentence` /
 * `detail` beside its
 * values. Which sensor is the CPU, which rows are nonsense, what an absence is
 * called - all of that is the skill's. This file decides only how a reading
 * LOOKS: a headline, a unit, and whether it has earned a ring.
 *
 * NO JSX, and ONE derivation: the card faces and the sheet read the same
 * `MachineRead` through the functions below, so a card and the sheet it opens
 * cannot disagree about what the machine said.
 */

import { useEffect, useState } from "react";

import { machineVitals } from "../../host";
import { HostError } from "../../host/transport.http";
import type { MachineVitals } from "../../types";
import type { AppFace } from "../FleetWheel";
import { batteryFace } from "./battery";
import { whileVisible } from "./whileVisible";

/**
 * TWO SECONDS, and @api's cache is the reason. The server holds a reading for
 * 1.0 s single-flight, so a 1 s poll would land on the cached sample about half
 * the time - twice the requests for the same numbers. At 2 s every read is past
 * the cache and is a fresh sample, the skill's own CPU and network window
 * becomes the gap between reads (published as `window_s`), and a fan spinning
 * up still shows inside two seconds - the across-the-room case this is for.
 */
export const MACHINE_POLL_MS = 2_000;

/**
 * Warm from this fraction of the sensor's own `high` line; hot AT that line.
 * On the MacBook this was built on `high` and `critical` are both 100 °C, so
 * warm starts at 85 °C and hot at 100. A sensor that publishes no `high` uses
 * its `critical` in the same place. Both lines are the sensor's - the fraction
 * is only where the colour starts to say "approaching".
 */
export const TEMP_WARM_FRACTION = 0.85;

/** One visit's latest outcome. Both null = nothing has answered yet. */
export interface MachineRead {
  reading: MachineVitals | null;
  /** The owner said no, or the host could not be reached - in its own words. */
  refusal: { code: string; message: string } | null;
}

const NOT_READ: MachineRead = { reading: null, refusal: null };

/**
 * Poll the machine while `active` - the monitor row is the visible wheel - and
 * while the screen is being looked at.
 *
 * NOTHING POLLS A POCKET (DPLAN-0305): `whileVisible` stops the interval when
 * the screen goes away and ticks once when it returns. NOTHING POLLS ANOTHER
 * LAYER either: leaving the monitor row tears the lane down and FORGETS the
 * last reading, so coming back draws the bare marks until a fresh answer lands
 * rather than last visit's numbers wearing the look of live ones.
 */
export function useMachineVitals(active: boolean): MachineRead {
  const [read, setRead] = useState<MachineRead>(NOT_READ);

  useEffect(() => {
    if (!active) return;
    let live = true;
    // One request at a time: a slow host must not stack reads behind itself.
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const reading = await machineVitals();
        if (!live) return;
        // Every refusal is a 503 on this route, so a 200 is a reading. A body
        // that says otherwise is still read as the refusal it is, never drawn.
        setRead(reading.ok ? { reading, refusal: null } : { reading: null, refusal: relayed(reading) });
      } catch (cause) {
        if (!live) return;
        setRead({
          reading: null,
          refusal: {
            code: cause instanceof HostError ? cause.code : "error",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
      } finally {
        busy = false;
      }
    };
    const stop = whileVisible(() => void tick(), MACHINE_POLL_MS);
    return () => {
      live = false;
      stop();
      setRead(NOT_READ);
    };
  }, [active]);

  return read;
}

/** A refusal that arrived with a success status, in the skill's own shape. */
function relayed(body: MachineVitals): { code: string; message: string } {
  const said = body as unknown as { reason?: string; detail?: string };
  return { code: said.reason ?? "refused", message: said.detail ?? said.reason ?? "the machine read was refused" };
}

/* ------------------------------------------------------------ the faces -- */

/** The cards whose reading has a range of its own - so a dead ring is how their
 *  absence looks. NET and PROC have no range, and never wear a ring. */
const GAUGES = new Set(["mon-cpu", "mon-mem", "mon-temp", "mon-fan", "mon-bat"]);

/** Every monitor card this derivation draws. The wheel owns the card list; this
 *  is the list of derivations, which is why a key can appear in both. */
const MONITOR_KEYS = ["mon-cpu", "mon-mem", "mon-temp", "mon-fan", "mon-net", "mon-proc", "mon-bat"];

/** An absent reading: a dash, never a zero - and on a gauge a dead ring, so the
 *  card's shape still says what would be there. */
const absent = (key: string): AppFace => ({ value: "—", absent: true, ring: GAUGES.has(key) ? "dead" : "none" });

/**
 * What each monitor card draws, by card key.
 *
 * EMPTY before the first answer of a visit: the cards draw their bare marks,
 * which is the one state that claims nothing. ON A REFUSAL every card draws the
 * dash - the owner said no, and the sheet says who, in the owner's words.
 */
export function machineFaces({ reading, refusal }: MachineRead): Record<string, AppFace> {
  if (!reading) {
    return refusal ? Object.fromEntries(MONITOR_KEYS.map((key) => [key, absent(key)])) : {};
  }
  const { cpu, memory, temp, fan, network, processes } = reading;
  return {
    "mon-cpu": percentFace("mon-cpu", cpu.available ? cpu.percent : null),
    "mon-mem": percentFace("mon-mem", memory.available ? memory.percent : null),
    "mon-temp": tempFace(temp),
    "mon-fan": fanFace(fan),
    "mon-net":
      network.available && network.sent_bytes_per_s !== null && network.recv_bytes_per_s !== null
        ? { ...rateFace(network.sent_bytes_per_s + network.recv_bytes_per_s), absent: false, ring: "none" }
        : absent("mon-net"),
    "mon-proc":
      processes.available && processes.count !== null
        ? { value: compact(processes.count), absent: false, ring: "none" }
        : absent("mon-proc"),
    "mon-bat": batteryFace(reading.battery),
  };
}

/** CPU, memory and a ranged fan: the percent, and a ring of the same percent.
 *  NO warm or hot here - those readings publish no line to be warm against, and
 *  a colour threshold this face made up would be an invented scale. */
function percentFace(key: string, percent: number | null): AppFace {
  if (percent === null) return absent(key);
  return {
    value: String(Math.round(percent)),
    unit: "%",
    absent: false,
    ring: { percent: clampPercent(percent), tone: "normal" },
  };
}

/** The package temperature. The ring's scale is the SENSOR'S `critical`, never a
 *  constant - a sensor that publishes none gets the number and no ring. */
function tempFace(temp: MachineVitals["temp"]): AppFace {
  if (!temp.available || temp.celsius === null) return absent("mon-temp");
  const face = { value: String(Math.round(temp.celsius)), unit: "°C", absent: false };
  if (temp.critical === null || temp.critical <= 0) return { ...face, ring: "none" };
  return {
    ...face,
    ring: {
      percent: clampPercent((temp.celsius / temp.critical) * 100),
      tone: tempTone(temp.celsius, temp.high, temp.critical),
    },
  };
}

/** Where a temperature sits against its sensor's lines - see TEMP_WARM_FRACTION. */
export function tempTone(celsius: number, high: number | null, critical: number | null): "normal" | "warm" | "hot" {
  const line = high ?? critical;
  if (line === null) return "normal";
  if (celsius >= line) return "hot";
  return celsius >= line * TEMP_WARM_FRACTION ? "warm" : "normal";
}

/** The fan: percent of its range, and the ring. A real rpm with NO range
 *  (`no_range`) draws the rpm and no ring - a number with no scale must not
 *  wear one, and the sheet carries the skill's sentence saying why. */
function fanFace(fan: MachineVitals["fan"]): AppFace {
  if (fan.reason === "no_range" && fan.current !== null) {
    return { value: compact(fan.current), unit: "rpm", absent: false, ring: "none" };
  }
  if (!fan.available) return absent("mon-fan");
  return percentFace("mon-fan", fan.percent_of_range);
}

function rateFace(bytesPerSecond: number): { value: string; unit: string } {
  const [value, unit] = rateParts(bytesPerSecond);
  return { value, unit };
}

/* ------------------------------------------------------------ the words -- */

const clampPercent = (percent: number) => Math.max(0, Math.min(100, percent));

/** A count that fits a 44px card: 412, 1.2k, 12k. */
export function compact(count: number): string {
  if (count < 1000) return String(Math.round(count));
  // 9_950 and not 10_000: 9999 would print "10.0k", five characters in a 44px box.
  return count < 9_950 ? `${(count / 1000).toFixed(1)}k` : `${Math.round(count / 1000)}k`;
}

/**
 * A byte rate, humanly - 1024-stepped, and never more than three digits, so it
 * fits the card: 340 B/s, 12 KB/s, 1.4 MB/s. The unit steps up at 1000 rather
 * than 1024 so "1010 B/s" never appears; it reads "1.0 KB/s" instead.
 */
export function rateParts(bytesPerSecond: number): [string, string] {
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = Math.max(0, bytesPerSecond);
  let step = 0;
  while (value >= 1000 && step < units.length - 1) {
    value /= 1024;
    step += 1;
  }
  return [step > 0 && value < 10 ? value.toFixed(1) : String(Math.round(value)), units[step]];
}

export const rateText = (bytesPerSecond: number) => rateParts(bytesPerSecond).join(" ");

/** Bytes as memory is spoken of: MiB under a gibibyte, GiB to one place above. */
export function bytesText(bytes: number): string {
  const mib = bytes / 1024 ** 2;
  return mib < 1024 ? `${Math.round(mib)} MiB` : `${(mib / 1024).toFixed(1)} GiB`;
}
