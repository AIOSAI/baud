/**
 * THE TRAIL - where `‹` goes back to (DPLAN-0414 wave 6).
 *
 * The owner, 16:29: "Yes i agree back just goes back to where it came from."
 * The rule as ruled: `‹` and the phone's own Back return to exactly the
 * screen, folder or card you came from, one level at a time; only the close
 * glyph closes outright; opening anything never discards what it was opened
 * from.
 *
 * WHY A TRAIL AND NOT FIFTEEN PARENTS. The face holds its screens in fifteen
 * single slots (`expanded`, `passportOf`, `browsing`, ...), and every door
 * used to clear the slot it was pressed in, so the parent no longer existed
 * and every `‹` landed on the wheel. Teaching each slot its parent would be
 * fifteen small stacks that disagree. One list is the whole answer: a door
 * pushes a STOP naming the screen it leaves, `‹` pops the newest stop and the
 * face reopens what it names. The git app's own stack (git/GitApp.tsx) is the
 * pattern, at face scale.
 *
 * PURE, and that is why it is its own file. Nothing here touches React or the
 * DOM: PhoneApp holds the array in state and acts on what these functions
 * return, so every rule below is pinned by `trail.test.ts`.
 */

import type { BranchStatus } from "../../types";

/**
 * One files browse: whose tree, which project, the floor, which kind of root -
 * and, when it is the browse a file was opened from, the level it stood on.
 *
 * NAMED IN DPLAN-0414 C#9 (PhoneApp.tsx), MOVED HERE in wave 6 because the
 * trail and the file pane's `from` now both carry one, and a type named in two
 * files is two types the day one of them grows a field.
 */
export interface Browse {
  name: string;
  project: string;
  /** The floor: "" for the files door, `artifacts` for the passport's records
   *  door (compass #291). */
  start: string;
  /** Which KIND of word `name` is, when the browse came off the roots roster
   *  (FPLAN-0443). Absent for every door that names a citizen, which is every
   *  door that existed before it. */
  root?: string;
  /** The level the browse opens at, under `start` (C#9). Absent is the floor. */
  at?: string;
}

/**
 * A screen the operator LEFT through a door, and so the screen `‹` reopens.
 *
 * Three kinds, because three screens have doors that lead to other screens:
 *  - `card`: the agent card. Every card door that opens a screen (README,
 *    inbox, plans, todos, memory, files, claude-settings, passport) leaves it.
 *    Panes (attach, resume, fresh, shell, watch, monitors) do not: their
 *    destination is the stage, and the card closing is the point.
 *  - `roots`: the files app's roster. A pick leaves it for a browse.
 *  - `passport`: the passport's records door leaves it for the artifacts
 *    browse. `held` is the card as it was, the passport's own fallback (see
 *    `passportOf` in PhoneApp), so a passport reopened after its agent left
 *    the poll still has something to show.
 *
 * NO `browse` STOP. A file opened from a browse is a TAB, and the browse rides
 * that tab's pane (`OpenPane.from`, wave 5) with the trail it stood on - so the
 * folder is never on this list, it is on the pane. NO `feed` STOP either: the
 * bell's inbox opens OVER the feed, which stays mounted under it and keeps its
 * scroll, so there is nothing to reopen.
 */
export type Stop =
  | { kind: "card"; ref: string }
  | { kind: "roots" }
  | { kind: "passport"; ref: string; held: BranchStatus };

/**
 * The most stops the trail keeps. The deepest real walk is three (card →
 * passport → artifacts browse); a cap exists so that no sequence of doors can
 * grow a list nobody walks. Past it the OLDEST stop goes: the near end of the
 * trail is the one a thumb reaches.
 */
export const TRAIL_CAP = 8;

/**
 * Leave a screen through a door: the trail with `stop` on the end.
 *
 * A new array, never the old one changed - this is React state.
 */
export function leave(trail: readonly Stop[], stop: Stop): Stop[] {
  return [...trail, stop].slice(-TRAIL_CAP);
}

/**
 * One step back: the stop to reopen, and the trail without it.
 *
 * `to` null is the wheel - an empty trail means the screen being left was
 * opened from the resting face, and that is where `‹` lands.
 */
export function stepBack(trail: readonly Stop[]): { to: Stop | null; rest: Stop[] } {
  if (trail.length === 0) return { to: null, rest: [] };
  return { to: trail[trail.length - 1], rest: trail.slice(0, -1) };
}

/**
 * THE WORD ON THE `‹` CHIP: where one step back lands, named the way the git
 * app names its own (`‹ card`, `‹ git`). Item 10 of the wave: every `‹` names
 * its destination, so `‹ back` is never the word for a screen the trail knows.
 */
export function backWord(trail: readonly Stop[]): string {
  const top = trail[trail.length - 1];
  if (!top) return "wheel";
  if (top.kind === "card") return "card";
  if (top.kind === "roots") return "roster";
  return "passport";
}
