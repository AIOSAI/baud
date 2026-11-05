/** The orb's inputs, pure: fleet entries to ring dots, the open agent to a mode, a mode to an energy level. */

import type { FleetEntry, OrbInputs, OrbMode, Ring } from "../messages";

/** `<project>/<name>`, as the contract names an agent. */
export const agentId = (b: Pick<FleetEntry, "project" | "name">) => `${b.project}/${b.name}`;

const working = (b: FleetEntry) => b.busy === true || b.state === "working";

/** Only agents with a live session or a dispatch get a dot; `dispatched` may arrive as a flag or a count. */
export function ringsOf(branches: FleetEntry[]): Ring[] {
  return branches
    .filter((b) => b.interactive || !!b.dispatched)
    .map((b) => ({ working: working(b), dispatched: !!b.dispatched, subagents: Math.max(0, Number(b.subagents) || 0) }));
}

/** The panel's word wins while it speaks for the open agent; without it the fleet entry's busy is all there is. */
export function orbMode(open: string | null, branches: FleetEntry[], panel: OrbInputs | null): { mode: OrbMode; speaker: number } {
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

/** The deck's energy(): a floor per mode, the voice on top. */
export function energy(mode: OrbMode, voice: number, t: number): number {
  if (mode === "speaking") return Math.max(voice, 0.25 + 0.1 * Math.abs(Math.sin(t * 7) * Math.sin(t * 2.3)));
  if (mode === "thinking") return Math.max(voice, 0.18 + 0.08 * Math.sin(t * 1.2));
  if (mode === "acting") return Math.max(voice, 0.25 + 0.15 * Math.abs(Math.sin(t * 9)));
  if (mode === "listening") return Math.max(voice, 0.12 + 0.1 * Math.abs(Math.sin(t * 3.1) * Math.sin(t * 0.7)));
  return Math.max(voice, 0.05 + 0.03 * Math.sin(t * 0.9));
}
