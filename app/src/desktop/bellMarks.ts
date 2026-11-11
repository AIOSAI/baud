/** The bell's cleared mark and its mail-row door. Reference: docs/desktop/rooms.md */

import { mailAddress } from "../phone/lib/inbox";
import type { NotificationEvent } from "../types";
import type { CardView } from "./phoneView";

/** One key for the machine, as the phone's bell keeps: a clear is the operator's, not a project's. */
export const CLEARED_KEY = "baud-bell-cleared";

function legacyKey(project: string): string {
  return `${CLEARED_KEY}:${project}`;
}

export type MarkStore = Pick<Storage, "getItem" | "setItem">;

/** The machine-wide key wins once it exists; the seated project's old per-project mark is lifted once. */
export function readCleared(store: MarkStore, project: string | null): string {
  const held = store.getItem(CLEARED_KEY);
  if (held !== null) return held;
  const old = project ? store.getItem(legacyKey(project)) : null;
  if (!old) return "";
  store.setItem(CLEARED_KEY, old);
  return old;
}

export function writeCleared(store: MarkStore, value: string): void {
  store.setItem(CLEARED_KEY, value);
}

/**
 * The message a mail row opens, or null for a row with no address. The line's own project wins;
 * the seat stands in for an older line, and a wrong guess is safe since the message is matched by id.
 */
export function bellMailView(event: NotificationEvent, seated: string | null): CardView | null {
  const address = mailAddress(event);
  if (!address) return null;
  const project = address.project ?? seated;
  if (!project) return null;
  return { screen: "inbox", branch: address.recipient, project, openId: address.mailId };
}
