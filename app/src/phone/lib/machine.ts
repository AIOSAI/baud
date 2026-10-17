/**
 * The machine lane: polls `/v1/machine` and derives what each monitor card and the sheet draw.
 * Reference: docs/phone/monitor.md
 */

import { useEffect, useState } from "react";

import { machineVitals } from "../../host";
import { HostError } from "../../host/transport.http";
import type { MachineVitals } from "../../types";
import type { AppFace } from "../FleetWheel";
import { batteryFace } from "./battery";
import { whileVisible } from "./whileVisible";

/** 2 s, past @api's 1 s single-flight cache, so every read is a fresh sample. */
export const MACHINE_POLL_MS = 2_000;

export const TEMP_WARM_FRACTION = 0.85;

export interface MachineRead {
  reading: MachineVitals | null;
  refusal: { code: string; message: string } | null;
}

const NOT_READ: MachineRead = { reading: null, refusal: null };

/** Poll while `active` and visible; leaving forgets the reading so stale numbers never look live. */
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
        // Every refusal is a 503 here; a 200 body that refuses is still read as a refusal.
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

function relayed(body: MachineVitals): { code: string; message: string } {
  const said = body as unknown as { reason?: string; detail?: string };
  return { code: said.reason ?? "refused", message: said.detail ?? said.reason ?? "the machine read was refused" };
}


/** Ranged cards: their absence is a dead ring. NET and PROC never wear a ring. */
const GAUGES = new Set(["mon-cpu", "mon-mem", "mon-temp", "mon-fan", "mon-bat"]);

/** The derivations, not the wheel's card list; a key can appear in both. */
const MONITOR_KEYS = ["mon-cpu", "mon-mem", "mon-temp", "mon-fan", "mon-net", "mon-proc", "mon-bat"];

const absent = (key: string): AppFace => ({ value: "—", absent: true, ring: GAUGES.has(key) ? "dead" : "none" });

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

/** No warm or hot: these readings publish no line, and a made-up threshold is an invented scale. */
function percentFace(key: string, percent: number | null): AppFace {
  if (percent === null) return absent(key);
  return {
    value: String(Math.round(percent)),
    unit: "%",
    absent: false,
    ring: { percent: clampPercent(percent), tone: "normal" },
  };
}

/** The ring's scale is the sensor's `critical`; a sensor with none gets no ring. */
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

export function tempTone(celsius: number, high: number | null, critical: number | null): "normal" | "warm" | "hot" {
  const line = high ?? critical;
  if (line === null) return "normal";
  if (celsius >= line) return "hot";
  return celsius >= line * TEMP_WARM_FRACTION ? "warm" : "normal";
}

/** A real rpm with no range draws the rpm and no ring: a number with no scale must not wear one. */
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


const clampPercent = (percent: number) => Math.max(0, Math.min(100, percent));

export function compact(count: number): string {
  if (count < 1000) return String(Math.round(count));
  // 9_950, not 10_000: 9999 would print "10.0k", too wide for a 44px card.
  return count < 9_950 ? `${(count / 1000).toFixed(1)}k` : `${Math.round(count / 1000)}k`;
}

/** 1024-stepped but stepping up at 1000, so it never shows four digits ("1.0 KB/s", not "1010 B/s"). */
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

export function bytesText(bytes: number): string {
  const mib = bytes / 1024 ** 2;
  return mib < 1024 ? `${Math.round(mib)} MiB` : `${(mib / 1024).toFixed(1)} GiB`;
}
