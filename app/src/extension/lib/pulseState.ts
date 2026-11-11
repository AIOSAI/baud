/** The pulse's inputs, pure: fleet entries to agent ticks, the open agent to a mode, a mode to an energy level. */

import type { FleetEntry, PulseInputs, PulseMode, Ring } from "../messages";

/** `<project>/<name>`, as the contract names an agent. */
export const agentId = (b: Pick<FleetEntry, "project" | "name">) => `${b.project}/${b.name}`;

const working = (b: FleetEntry) => b.busy === true || b.state === "working" || b.delegating === true;

/** Only agents with a live session or a dispatch get a dot. */
export function ringsOf(branches: FleetEntry[]): Ring[] {
  return branches
    .filter((b) => b.interactive || !!b.dispatched)
    .map((b) => ({ working: working(b), dispatched: !!b.dispatched, subagents: Math.max(0, Number(b.subagents) || 0) }));
}

/** The panel's word wins while it speaks for the open agent; without it the fleet entry's busy is all there is. */
export function pulseMode(open: string | null, branches: FleetEntry[], panel: PulseInputs | null): { mode: PulseMode; speaker: number } {
  if (!open) return { mode: "idle", speaker: 0 };
  if (panel) {
    const speaker = panel.speaking ? panel.loudness : 0;
    if (panel.speaking) return { mode: "speaking", speaker };
    if (panel.waiting) return { mode: "listening", speaker };
    if (panel.busy) return { mode: panel.acting ? "acting" : "thinking", speaker };
    return { mode: "idle", speaker };
  }
  const entry = branches.find((b) => agentId(b) === open);
  return { mode: entry && working(entry) ? "thinking" : "idle", speaker: 0 };
}

const FLOOR: Record<PulseMode, number> = { idle: 0.04, listening: 0.15, thinking: 0.2, speaking: 0.3, acting: 0.32 };

/** How high the bars run: a floor per mode with a slow ripple, the voice on top when it is louder. */
export function energy(mode: PulseMode, voice: number, t: number): number {
  return Math.max(voice, FLOOR[mode] * (1 + 0.15 * Math.sin(t * 2)));
}
