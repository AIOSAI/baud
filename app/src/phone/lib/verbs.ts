/** The phone's verb register: wake and end room per card, plus the one machine lock. Reference: docs/phone/wheel.md */

import { verbKill, verbLock, verbWake } from "../../host";
import type { BranchStatus, VerbResult } from "../../types";

export type Scope = "read" | "operate" | string;

export interface PhoneVerb {
  /** Stable id - what a gate is keyed on, never the label. */
  id: string;
  label: string;
  title: (branch: BranchStatus) => string;
  destructive: boolean;
  availability: (branch: BranchStatus) => { ready: true } | { ready: false; reason: string };
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
    // No model: the branch's own config decides what wakes in it.
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
    availability: (branch) =>
      branch.has_room || branch.outside_room !== null
        ? { ready: true }
        : { ready: false, reason: "no room here to end" },
    // The project travels with the branch: a room name resolved against another project kills a different session.
    run: (branch) => verbKill(branch.name, branch.project),
  },
];

export const LOCK_VERB = {
  id: "lock",
  label: "lock screen",
  title: "lock this machine's screen",
  destructive: false,
  run: (): Promise<VerbResult> => verbLock(),
};

export function hasVerbs(): boolean {
  return PHONE_VERBS.length > 0;
}

export function scopeRefusal(scope: Scope): string | null {
  if (scope === "operate") return null;
  return `this token is ${scope}-scoped — verbs need an operate token`;
}

/** Is anybody looking? This, scope and confirmation are pocket safety only; the server must not trust them. */
export function screenIsAwake(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible";
}
