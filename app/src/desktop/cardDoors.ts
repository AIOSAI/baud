/** Which designed screen each door on an agent card opens, and whether the terminal holds the card's room. Reference: docs/desktop/window-and-cards.md */

import type { CardView } from "./phoneView";

export type CardDoor = "inbox" | "plans" | "todos" | "git" | "files";

/** The card's own project rides on every view: an empty project would read the host's seat, not the card's. */
export function cardDoorView(door: CardDoor, branch: { name: string; project: string }): CardView {
  const who = { branch: branch.name, project: branch.project };
  switch (door) {
    case "inbox":
      return { screen: "inbox", ...who };
    case "plans":
      return { screen: "plans", ...who };
    case "todos":
      return { screen: "memory", ...who, initialTab: "todos" };
    case "git":
      return { screen: "branch-git", ...who };
    case "files":
      return { screen: "branch-files", ...who };
  }
}

/** The terminal's attached room, as it reports it; the project is the one the attach named. */
export interface HeldRoom {
  room: string;
  project: string | null;
}

/** Name AND project: two projects can each hold a room for a same-named agent. */
export function holdsRoom(held: HeldRoom | null, branch: { name: string; project: string }): boolean {
  return held !== null && held.room === branch.name && held.project === branch.project;
}
