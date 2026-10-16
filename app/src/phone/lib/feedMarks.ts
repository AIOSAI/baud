/**
 * THE BELL'S TWO MARKERS, ONE MACHINE-WIDE KEY EACH (DPLAN-0414 A#4).
 *
 * `/v1/feed` takes no project and the phone sends none (`notificationsFeed`
 * in host/index.ts), so there is ONE feed on this machine. The markers used to
 * be keyed per project, after the desktop bell's key shape, and that put two
 * histories over one feed: a project switch brought every read event back as
 * unread, and a clear in one project left the same events standing in the
 * next. Now the read marker and the cleared marker each have one key, the
 * same whichever project is seated.
 *
 * THE OLD KEYS ARE LIFTED ONCE, NOT DELETED. The first time a phone reads a
 * marker that has no machine-wide value yet, the seated project's old
 * per-project mark is copied across, so the phone does not show its whole
 * feed as unread on the day this lands. After that the machine-wide key
 * exists and always wins; the old keys are never read again. They are left
 * where they are - a few bytes each, and other projects' old marks are not
 * this lift's to judge (the seated one is the mark the operator last saw).
 *
 * Display only, both of them: localStorage timestamps, never a write to the
 * feed, which ai_mail alone authors.
 */

/** Which marker. "read" moves when the feed closes; "cleared" when clear is tapped. */
export type FeedMark = "read" | "cleared";

/** The one key each marker lives under, on every project. */
export function markKey(mark: FeedMark): string {
  return `baud-phone-feed-${mark}`;
}

/** The per-project key the marker lived under before DPLAN-0414 A#4. Read only by the lift. */
export function legacyMarkKey(mark: FeedMark, project: string): string {
  return `baud-phone-feed-${mark}:${project}`;
}

/** The two calls of `Storage` the markers use - a fake one in the tests. */
export type MarkStore = Pick<Storage, "getItem" | "setItem">;

/**
 * The marker's value, lifting the seated project's old mark the first time.
 *
 * The machine-wide key wins whenever it exists, even when it is older than
 * the project's old mark: once it exists it IS the bell's history, and a
 * lift that ran on every seat would bring the per-project behaviour back.
 * When it does not exist and the old key does, the old value is written to
 * the new key and returned. Neither: "" (nothing read, nothing cleared).
 */
export function readMark(store: MarkStore, mark: FeedMark, project: string): string {
  const held = store.getItem(markKey(mark));
  if (held !== null) return held;
  const old = project ? store.getItem(legacyMarkKey(mark, project)) : null;
  if (!old) return "";
  store.setItem(markKey(mark), old);
  return old;
}

/** Move a marker. One key, whichever project is seated. */
export function writeMark(store: MarkStore, mark: FeedMark, value: string): void {
  store.setItem(markKey(mark), value);
}
