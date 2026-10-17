/**
 * THE TAB ROW, KEPT ACROSS A RELOAD (DPLAN-0414 wave 6, items 3 and 4).
 *
 * The owner, 16:20: "Yea its annoying when a tab drops i have to start again."
 * The back survey found the likeliest cause: `open[]` and `active` lived only
 * in React state, so the header's own reload button, a pull-to-refresh or a
 * PWA restart dropped every tab - while the comment on that button called the
 * reload lossless. The tabs now sit in localStorage beside the seat
 * (`baud-phone-project`), and the face reads them back on load.
 *
 * WHAT A RESTORE IS, AND WHAT IT IS NOT. A restored room, shell or watch tab
 * is a REATTACH through the lane it always used: the room lives in tmux on
 * the host, so the tab only has to find it again. It is never a door press -
 * PhoneApp marks every restored pane `restored`, and TerminalSheet types no
 * launch line into a restored room (a stored card's `interactive` is from the
 * last session; trusting it is how a second claude gets started). A restored
 * file tab simply re-reads. A tab whose agent has left the census is dropped
 * with one console line, not an error screen.
 *
 * AND THE FOCUS HISTORY (item 4). Closing a tab used to front the RIGHTMOST
 * one left, so closing a file you opened from a room landed on some other
 * file. `focus` is the order tabs were fronted in; closing the front tab
 * fronts the one before it. It is kept with the tabs, so a reload remembers
 * it too.
 *
 * PURE, like `trail.ts`: storage is passed in (a fake in the tests), and the
 * pane's identity is PhoneApp's `paneKey`, handed in rather than copied here.
 */

import type { BranchStatus } from "../../types";
import type { Browse, Stop } from "./trail";

/** The localStorage key, beside `baud-phone-project` (PhoneApp's PROJECT_KEY). */
export const TABS_KEY = "baud-phone-tabs";

/** The stored shape's version. A blob with any other is not read. */
export const TABS_VERSION = 1;

/** How many fronted keys the focus history keeps. A row past this is not a
 *  row a thumb walks back through, and the list must not grow for ever. */
export const FOCUS_CAP = 24;

/** Every mode a pane can have: the launch modes, shell, watch, file. */
const MODES = ["fresh", "resume", "shell", "watch", "file"] as const;

/**
 * One pane as it is stored and read back - the fields of PhoneApp's
 * `OpenPane`, same names and types, so a pane read here is an `OpenPane`
 * without a cast. See `OpenPane` for what each one means.
 *
 * `command` is NEVER stored: it is a one-shot line typed when the `?` door
 * opens a shell, and a reload is not that door. `restored` is never stored
 * either; `loadTabs` sets it on everything it reads.
 */
export interface StoredPane {
  name: string;
  mode: (typeof MODES)[number];
  ref?: string;
  root?: string;
  project?: string;
  document?: "certificate";
  from?: Browse;
  fromTrail?: Stop[];
  command?: string;
  card?: BranchStatus;
  restored?: boolean;
}

/** The tab row: the panes in row order, which one is in front, and the order
 *  tabs were fronted in (oldest first). */
export interface Tabs<P> {
  open: P[];
  active: string | null;
  focus: string[];
}

/** The two calls of `Storage` this file uses - a fake one in the tests. */
export type TabStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * A tab was fronted: the focus history with `key` moved to the end.
 *
 * A key fronted twice appears once, at its newest place. Past `FOCUS_CAP`
 * the oldest goes.
 */
export function focusOn(focus: readonly string[], key: string): string[] {
  return [...focus.filter((held) => held !== key), key].slice(-FOCUS_CAP);
}

/**
 * A tab was closed: who is in front now, and the history without it.
 *
 * `keys` is the row BEFORE the close. Closing a tab that is not in front
 * leaves the front tab alone. Closing the front tab fronts the most recently
 * fronted tab still in the row; with no history left, the rightmost remaining
 * tab (the old rule, kept as the floor); with no tab left, nothing.
 */
export function closeTab(
  keys: readonly string[],
  focus: readonly string[],
  active: string | null,
  closing: string,
): { active: string | null; focus: string[] } {
  const left = keys.filter((key) => key !== closing);
  const history = focus.filter((key) => key !== closing && left.includes(key));
  if (active !== closing) return { active, focus: history };
  const before = history[history.length - 1];
  if (before !== undefined) return { active: before, focus: history };
  return { active: left.length ? left[left.length - 1] : null, focus: history };
}

/** The pane as it goes into storage: everything but the one-shot line and
 *  the restore mark. */
function forStorage(pane: StoredPane): StoredPane {
  const { command: _command, restored: _restored, ...kept } = pane;
  return kept;
}

/** Write the tab row. Called on every change to it; a refusing storage
 *  (private mode, quota) loses the restore, never the session. */
export function saveTabs(store: TabStorage, tabs: Tabs<StoredPane>): void {
  try {
    store.setItem(
      TABS_KEY,
      JSON.stringify({
        v: TABS_VERSION,
        open: tabs.open.map(forStorage),
        active: tabs.active,
        focus: tabs.focus,
      }),
    );
  } catch {
    // Nothing to tell: the tabs on screen are untouched, only the next load
    // will not find them.
  }
}

const isText = (value: unknown): value is string => typeof value === "string";
const optionalText = (value: unknown) => value === undefined || isText(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One stored pane, checked field by field - or null when it is not one. A
 *  hand-edited or older blob drops the pane, never the face. */
function readPane(value: unknown): StoredPane | null {
  if (!isRecord(value)) return null;
  const { name, mode, ref, root, project, document, from, fromTrail, card } = value;
  if (!isText(name) || !MODES.includes(mode as StoredPane["mode"])) return null;
  if (!optionalText(ref) || !optionalText(root) || !optionalText(project)) return null;
  if (mode === "file" && !isText(ref)) return null;
  if (document !== undefined && document !== "certificate") return null;
  if (from !== undefined && !(isRecord(from) && isText(from.name) && isText(from.start))) return null;
  if (fromTrail !== undefined && !Array.isArray(fromTrail)) return null;
  if (card !== undefined && !(isRecord(card) && isText(card.name))) return null;
  return { ...(value as unknown as StoredPane), restored: true };
}

/**
 * Read the tab row back, or null when there is none to read.
 *
 * Null for: no key, a blob that is not JSON, another version, or no pane that
 * survives `readPane`. Every pane read is marked `restored`. An `active` that
 * names no surviving pane falls to the newest fronted one that does, then to
 * the rightmost.
 */
export function loadTabs(store: TabStorage, keyOf: (pane: StoredPane) => string): Tabs<StoredPane> | null {
  let raw: string | null;
  try {
    raw = store.getItem(TABS_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== TABS_VERSION || !Array.isArray(parsed.open)) return null;
  const open = parsed.open.map(readPane).filter((pane): pane is StoredPane => pane !== null);
  if (open.length === 0) return null;
  const keys = open.map(keyOf);
  const focus = Array.isArray(parsed.focus) ? parsed.focus.filter(isText).filter((key) => keys.includes(key)) : [];
  return { open, active: frontOf(keys, focus, parsed.active), focus };
}

/** The front tab: `wanted` when it is in the row, else the newest fronted,
 *  else the rightmost. */
function frontOf(keys: readonly string[], focus: readonly string[], wanted: unknown): string | null {
  if (isText(wanted) && keys.includes(wanted)) return wanted;
  const fronted = focus[focus.length - 1];
  if (fronted !== undefined) return fronted;
  return keys.length ? keys[keys.length - 1] : null;
}

/**
 * Who is on the machine now, as the first fleet read after load saw it.
 *
 * `seated` is the seated project's cards, null when that read failed (a read
 * that failed is not a project with no agents). `roster` is the cross-project
 * roster, null when it was refused. A pane is only ever dropped against a
 * list that ANSWERED.
 */
export interface Census {
  seat: string;
  seated: readonly BranchStatus[] | null;
  roster: readonly BranchStatus[] | null;
}

/**
 * Check restored panes against the census.
 *
 * A pane that names an agent (a room, a named shell or watch) takes that
 * agent's card FRESH from the census, so the room it reattaches to is judged
 * on what is true now. One whose agent is in no list that answered is
 * dropped, with one line saying so. Panes that name no agent - the
 * project-root shell, mission control, every file - are kept as they are: a
 * file re-reads, and its own read says if it is gone.
 *
 * When the list a pane would be found in did not answer, the pane is KEPT on
 * its stored card: an unanswered read is no evidence the agent left.
 */
export function restoreTabs(
  tabs: Tabs<StoredPane>,
  census: Census,
  keyOf: (pane: StoredPane) => string,
): Tabs<StoredPane> & { dropped: string[] } {
  const dropped: string[] = [];
  const open: StoredPane[] = [];
  for (const pane of tabs.open) {
    if (pane.mode === "file" || !pane.name) {
      open.push(pane);
      continue;
    }
    const where = pane.project || census.seat;
    const list = where === census.seat ? census.seated : census.roster;
    const pool = [...(census.seated ?? []), ...(census.roster ?? [])];
    const card = pool.find((each) => each.name === pane.name && (each.project || census.seat) === where);
    if (card) open.push({ ...pane, card });
    else if (list === null) open.push(pane);
    else dropped.push(`restored tab dropped: ${pane.name} has no card in ${where || "the seated project"} now`);
  }
  const keys = open.map(keyOf);
  const focus = tabs.focus.filter((key) => keys.includes(key));
  return { open, active: frontOf(keys, focus, tabs.active), focus, dropped };
}

/**
 * Fold the restored row into whatever HANDS opened while the census was
 * being read.
 *
 * Hands win: a pane the operator opened stays, at the end of the row, and
 * stays in front. A restored pane with the same key is left out (the hand's is
 * the fresher door), and so is a restored agent seat when the hands already
 * took one - the face holds ONE agent seat (PhoneApp `focusPane`), and the
 * operator's pick outranks a memory of yesterday's.
 */
export function mergeTabs<P extends StoredPane>(
  restored: Tabs<P>,
  current: Tabs<P>,
  keyOf: (pane: P) => string,
  isSeat: (pane: P) => boolean,
): Tabs<P> {
  const handKeys = current.open.map(keyOf);
  const handSeat = current.open.some(isSeat);
  const kept = restored.open.filter((pane) => !handKeys.includes(keyOf(pane)) && !(handSeat && isSeat(pane)));
  const open = [...kept, ...current.open];
  const keys = open.map(keyOf);
  let focus = restored.focus.filter((key) => keys.includes(key));
  for (const key of current.focus) focus = focusOn(focus, key);
  const active = current.active ?? (restored.active !== null && keys.includes(restored.active) ? restored.active : null);
  return { open, active: active ?? frontOf(keys, focus, null), focus };
}
