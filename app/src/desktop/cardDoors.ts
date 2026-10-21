/** Which designed screen each door on an agent card opens, and the fenced gear's reason. Reference: docs/desktop/window-and-cards.md */

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

/** The phone's wording (AgentSheet): the settings panel's memory dials write by branch name alone. */
export function gearFence(name: string, project: string): string {
  return `${name}'s settings live in ${project}, and this panel's memory dials name no project — they would edit the seated project's ${name}. Switch to ${project} first.`;
}

/** The card's visible line, since a disabled gear's tooltip is not a reason anyone sees. */
export function awayNote(name: string, project: string): string {
  return `${name} lives in ${project}: read it, watch it, attach it from here. Only the settings gear stays behind: its memory dials name no project.`;
}
