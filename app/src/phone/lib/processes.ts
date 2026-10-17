/** The PROC sheet's order and words; pure. Never polled: each sample costs @skills about half a second. */

import type { MachineProcesses } from "../../types";

export const PROCESS_LIMIT = 20;

export type ProcessRow = MachineProcesses["processes"][number];

export type ProcessSort = "cpu" | "mem";

// A new array, so the held read keeps the host's order; ties fall to the other share, then host order.
export function sortProcesses(rows: readonly ProcessRow[], by: ProcessSort): ProcessRow[] {
  const first = by === "cpu" ? "cpu_pct" : "mem_pct";
  const then = by === "cpu" ? "mem_pct" : "cpu_pct";
  return [...rows].sort((a, b) => b[first] - a[first] || b[then] - a[then]);
}

export function processName(row: ProcessRow): string {
  const name = row.name.trim();
  return name ? name : `pid ${row.pid}`;
}

export const pctText = (value: number): string => `${value.toFixed(1)}%`;

export const memText = (mb: number): string => `${Math.round(mb)} MB`;

export function sampledLine(read: MachineProcesses | null, sampling: boolean, timeOf: (iso: string) => string): string {
  if (sampling) return "sampling…";
  if (!read) return "tap to sample";
  const over = `${(read.window_ms / 1000).toFixed(1)} s`;
  return `top ${read.processes.length} of ${read.total} · sampled ${timeOf(read.sampled_at)} over ${over} · tap to sample again`;
}
