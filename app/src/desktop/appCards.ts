/** The strip's app cards and the machine tab's tiles, as data. Reference: docs/desktop/apps.md */

import type { AppView } from "./phoneView";

export type AppScreen = AppView["screen"];

export interface AppCard {
  screen: AppScreen;
  name: string;
  /** What the tab shows, for the card's title. */
  opens: string;
}

export const APP_CARDS: ReadonlyArray<AppCard> = [
  { screen: "git", name: "GIT", opens: "the repository's changes, log and remote" },
  { screen: "files", name: "FILES", opens: "the roots: branch, project, aipass, home" },
  { screen: "backup", name: "BACKUP", opens: "the backup store, its runs and Snapshot now" },
  { screen: "machine", name: "MACHINE", opens: "the machine's live vitals and the lock state" },
];

/** Null until the seat is read: an empty project would be the host's default seat, not this window's. */
export function appCardView(screen: AppScreen, seatedProject: string | null): AppView | null {
  if (seatedProject === null) return null;
  if (screen === "machine") return { screen };
  return { screen, project: seatedProject };
}

export function appCardTitle(card: AppCard, seatedProject: string | null): string {
  if (seatedProject === null) return `${card.name.toLowerCase()} - waits until the seat is read`;
  const where = card.screen === "machine" ? "this machine" : seatedProject;
  return `open ${card.name.toLowerCase()} in a tab - ${card.opens} (${where})`;
}

/** The wheel's monitor row, in its order; MachineSheet keys on these. */
export const MACHINE_TILES: ReadonlyArray<{ key: string; mark: string; name: string }> = [
  { key: "mon-cpu", mark: "CPU", name: "cpu" },
  { key: "mon-mem", mark: "MEM", name: "memory" },
  { key: "mon-temp", mark: "TEMP", name: "temperature" },
  { key: "mon-fan", mark: "FAN", name: "fan" },
  { key: "mon-net", mark: "NET", name: "network" },
  { key: "mon-proc", mark: "PROC", name: "processes" },
  { key: "mon-bat", mark: "BAT", name: "battery" },
];
