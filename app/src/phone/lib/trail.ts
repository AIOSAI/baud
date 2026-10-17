/** Where `‹` goes back to: the pure list of screens left through a door. Reference: docs/phone/settings-nav.md */

import type { BranchStatus } from "../../types";

export interface Browse {
  name: string;
  project: string;
  start: string;
  root?: string;
  at?: string;
}

/** A screen left through a door. No browse stop (it rides the tab's pane) and no feed stop (the inbox opens over it). */
export type Stop =
  | { kind: "card"; ref: string }
  | { kind: "roots" }
  | { kind: "passport"; ref: string; held: BranchStatus };

export const TRAIL_CAP = 8;

export function leave(trail: readonly Stop[], stop: Stop): Stop[] {
  return [...trail, stop].slice(-TRAIL_CAP);
}

export function stepBack(trail: readonly Stop[]): { to: Stop | null; rest: Stop[] } {
  if (trail.length === 0) return { to: null, rest: [] };
  return { to: trail[trail.length - 1], rest: trail.slice(0, -1) };
}

export function backWord(trail: readonly Stop[]): string {
  const top = trail[trail.length - 1];
  if (!top) return "wheel";
  if (top.kind === "card") return "card";
  if (top.kind === "roots") return "roster";
  return "passport";
}
