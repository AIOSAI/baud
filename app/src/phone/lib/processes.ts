/**
 * THE PROCESS LIST - what the PROC card's sheet draws.
 *
 * The owner, 2026-10-16 14:27: *"list top 20. Its just a quick ref to see if
 * anything is high usage. Say I hear laptop fan going crazy and no agents
 * running. I'll be like what is running."* So the sheet is one glance: the
 * twenty processes the host measured as busiest, each with its cpu, its share
 * of memory and its resident size, and a toggle that re-orders the SAME twenty
 * by memory. Nothing is asked of the host twice for a sort.
 *
 * WHERE THE MEANING LIVES: in @skills' `machine_processes()`. The sample, the
 * normalisation (a 4-core box at full tilt sums to about 100, not 400), which
 * twenty, and the name a process goes by are all the skill's. This file only
 * decides ORDER and WORDS, and it is pure - no react, no host - so both are
 * pinned by `processes.test.ts` without a browser.
 *
 * NEVER POLLED. The skill sleeps about half a second per sample to measure cpu
 * honestly, so the sheet reads once when it opens and once per tap on its
 * sampled line. That is the sheet's business (`MachineSheet.tsx`); this file
 * holds the one number both agree on.
 */

import type { MachineProcesses } from "../../types";

/** How many rows the sheet asks for - the owner's number. */
export const PROCESS_LIMIT = 20;

/** One row as the wire carries it. */
export type ProcessRow = MachineProcesses["processes"][number];

/** The two orders the toggle offers. The host always sends `cpu`. */
export type ProcessSort = "cpu" | "mem";

/**
 * The same rows in the order the toggle asks for. A NEW array: the read is
 * held as the host sent it, so flipping back to cpu is the host's own order
 * again rather than a re-sort of a re-sort.
 *
 * cpu: busiest first, ties by memory share - the contract's own rule, applied
 * again here so a row the host sent out of order cannot sit out of place.
 * mem: biggest share first, ties by cpu. Anything still tied keeps the host's
 * order (`Array.prototype.sort` is stable).
 */
export function sortProcesses(rows: readonly ProcessRow[], by: ProcessSort): ProcessRow[] {
  const first = by === "cpu" ? "cpu_pct" : "mem_pct";
  const then = by === "cpu" ? "mem_pct" : "cpu_pct";
  return [...rows].sort((a, b) => b[first] - a[first] || b[then] - a[then]);
}

/** What a row is called: its name, or its pid when the name came back empty
 *  (a process can vanish between being listed and being named). */
export function processName(row: ProcessRow): string {
  const name = row.name.trim();
  return name ? name : `pid ${row.pid}`;
}

/** A percent to one place, the way the vitals sheet prints its percents. */
export const pctText = (value: number): string => `${value.toFixed(1)}%`;

/** Resident memory, as the contract sends it: whole MiB. */
export const memText = (mb: number): string => `${Math.round(mb)} MB`;

/**
 * The line under the list, and the tap that reads again.
 *
 * WHILE A SAMPLE IS IN FLIGHT it says "sampling…" - the skill is sitting out
 * its half second, and a blank list would read as "nothing is running". Once a
 * sample lands it says when it was taken, over how long, how many of the total
 * are shown, and that a tap reads again.
 */
export function sampledLine(read: MachineProcesses | null, sampling: boolean, timeOf: (iso: string) => string): string {
  if (sampling) return "sampling…";
  if (!read) return "tap to sample";
  const over = `${(read.window_ms / 1000).toFixed(1)} s`;
  return `top ${read.processes.length} of ${read.total} · sampled ${timeOf(read.sampled_at)} over ${over} · tap to sample again`;
}
