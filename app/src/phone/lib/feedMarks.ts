/** The bell's read/cleared markers: one machine-wide key each (`/v1/feed` takes no project); display only. */

export type FeedMark = "read" | "cleared";

export function markKey(mark: FeedMark): string {
  return `baud-phone-feed-${mark}`;
}

export function legacyMarkKey(mark: FeedMark, project: string): string {
  return `baud-phone-feed-${mark}:${project}`;
}

export type MarkStore = Pick<Storage, "getItem" | "setItem">;

/** The machine-wide key wins once it exists; the seated project's old per-project mark is lifted once. */
export function readMark(store: MarkStore, mark: FeedMark, project: string): string {
  const held = store.getItem(markKey(mark));
  if (held !== null) return held;
  const old = project ? store.getItem(legacyMarkKey(mark, project)) : null;
  if (!old) return "";
  store.setItem(markKey(mark), old);
  return old;
}

export function writeMark(store: MarkStore, mark: FeedMark, value: string): void {
  store.setItem(markKey(mark), value);
}
