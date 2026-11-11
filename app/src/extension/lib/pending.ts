/** What was sent to an agent and not yet seen in its feed, pure. A failed send stays here too, with resend and discard. */

import type { AgentLine } from "../../types";

/** A queued line shows in the feed within seconds even mid-turn; longer means it never arrived. */
export const PENDING_MS = 90_000;

export interface Pending {
  id: number;
  /** Exactly what goes on the wire: the Looking-at tag and image paths already in, so a resend keeps both. */
  sent: string;
  /** What the box showed, `[Image #n]` tags and all. */
  shown: string;
  at: number;
  /** Set when the send itself failed (409 no room, network): the host's own words. */
  failed: string | null;
}

export type PendingLook = "waiting" | "stale" | "failed";

export const lookOf = (p: Pending, now: number): PendingLook =>
  p.failed !== null ? "failed" : now - p.at > PENDING_MS ? "stale" : "waiting";

export const canResend = (p: Pending, now: number) => lookOf(p, now) !== "waiting";

const plain = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 60);

/** A delivered send drops off once the feed shows a user line opening with its words, at or after it was sent (5 s slack). */
export function settle(list: Pending[], lines: AgentLine[]): Pending[] {
  const mine = lines.filter((l) => l.role === "user" && l.time).map((l) => [Date.parse(l.time), plain(l.text)] as const);
  return list.filter((p) => p.failed !== null || !mine.some(([t, s]) => t >= p.at - 5000 && s.startsWith(plain(p.sent))));
}

export const add = (list: Pending[], p: Pending) => [...list, p];

export const failed = (list: Pending[], id: number, why: string) => list.map((p) => (p.id === id ? { ...p, failed: why } : p));

/** Resend goes out again as it was first sent, its clock restarted. */
export const resent = (list: Pending[], id: number, now: number) => list.map((p) => (p.id === id ? { ...p, failed: null, at: now } : p));

export const discard = (list: Pending[], id: number) => list.filter((p) => p.id !== id);
