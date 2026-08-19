/**
 * The verb register - filled in (FPLAN-0413 phase 6).
 *
 * It stood here exported and empty through phases 1-5, with its gates named:
 * C2 and the model-vocabulary ruling. Both landed on 2026-08-14, so this is the
 * file the reservation was for - the answer really was "fill this in" rather
 * than "design this".
 *
 * TERMINAL-AGNOSTIC, WHICH IS WHY `wake` TAKES NO MODEL. Patrick's ruling: the
 * branch's own config decides what wakes in it. A model field here would put a
 * vendor's word in the phone's contract and make the face care which terminal
 * is in the slot. There is not one such word in this file.
 *
 * THREE GUARDS, and each one is the client's job precisely because the SERVER
 * MUST NOT RELY ON ANY OF THEM. A phone is a thing that gets picked up by other
 * people; these make the pocket safer without pretending they are security.
 * The bearer token and the operate scope are the security.
 *
 *   1. SCOPE. A read-scoped session shows every verb REFUSED WITH ITS REASON,
 *      never hidden. A designed absence must not look like a bug - if the chips
 *      vanished, the operator would be left wondering whether the face was
 *      broken or the build was old.
 *   2. THE LOCK SCREEN. A destructive verb never fires from a page that is not
 *      actually being looked at. A tap queued behind a lock, or a stray touch
 *      through a pocket, must not end a session.
 *   3. CONFIRMATION. Destructive verbs ask first, using the platform's own user
 *      verification when it offers one. The server is not told the answer and
 *      does not want it.
 */

import { verbKill, verbLock, verbWake } from "../../host";
import type { BranchStatus, VerbResult } from "../../types";

/** What a token is allowed to do, straight from `/v1/whoami`. */
export type Scope = "read" | "operate" | string;

export interface PhoneVerb {
  /** Stable id - what a gate is keyed on, never the label. */
  id: string;
  /** What the chip says. */
  label: string;
  /** Why the operator would press it. */
  title: (branch: BranchStatus) => string;
  /**
   * Destructive verbs lose something that cannot be got back - a scrollback, a
   * session mid-thought. They ask first and they refuse a screen nobody is
   * looking at.
   */
  destructive: boolean;
  /**
   * Whether this branch can take it right now, and if not, WHY - the sentence
   * is shown to the operator, so it says what is true rather than "unavailable".
   */
  availability: (branch: BranchStatus) => { ready: true } | { ready: false; reason: string };
  /** The seam call. Verbs go through `host/index.ts` like everything else. */
  run: (branch: BranchStatus) => Promise<VerbResult>;
}

export const PHONE_VERBS: readonly PhoneVerb[] = [
  {
    id: "wake",
    label: "wake",
    title: (branch) => `wake ${branch.name} in its own branch`,
    destructive: false,
    availability: (branch) =>
      branch.is_citizen
        ? { ready: true }
        : { ready: false, reason: "not a citizen — nothing to wake here" },
    run: (branch) => verbWake(branch.name, branch.project, "Check inbox"),
  },
  {
    id: "kill",
    label: "end room",
    title: (branch) =>
      branch.outside_room
        ? `end '${branch.outside_room}' — the live session in this branch, which BAUD did not create`
        : `end ${branch.name}'s room`,
    destructive: true,
    // A room that does not exist cannot be ended, and saying so beats a chip
    // that fires into nothing and reports success.
    availability: (branch) =>
      branch.has_room || branch.outside_room !== null
        ? { ready: true }
        : { ready: false, reason: "no room here to end" },
    // The project travels WITH the branch. A room name carries its project
    // scope; resolving it against anything else names a different room and
    // kills a session nobody asked about (key learning #22).
    run: (branch) => verbKill(branch.name, branch.project),
  },
];

/**
 * The one verb that names no branch: it locks the machine the server runs on,
 * and there is exactly one of those. Kept out of the per-card register because
 * a lock chip on seventeen cards would be seventeen ways to do one thing.
 */
export const LOCK_VERB = {
  id: "lock",
  label: "lock screen",
  title: "lock this machine's screen",
  destructive: false,
  run: (): Promise<VerbResult> => verbLock(),
};

/** True once any verb has been cleared. Reads as true since phase 6. */
export function hasVerbs(): boolean {
  return PHONE_VERBS.length > 0;
}

/**
 * Why a verb cannot run under this session, or null when it can.
 *
 * Read scope is the expected everyday case, not an error: Patrick's phone token
 * stays read-scoped until the client story is proven. So the sentence explains
 * rather than scolds.
 */
export function scopeRefusal(scope: Scope): string | null {
  if (scope === "operate") return null;
  return `this token is ${scope}-scoped — verbs need an operate token`;
}

/**
 * Is anybody actually looking at this screen?
 *
 * A phone in a pocket still runs the page. A tap queued behind a lock still
 * arrives. Neither should be able to end a session, so destructive verbs check
 * at the moment of firing rather than trusting that a click means a human.
 *
 * The server does NOT trust this and must not: anyone can call the endpoint
 * with a valid operate token and no browser at all. This narrows the accident,
 * not the attack.
 */
export function screenIsAwake(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible";
}
