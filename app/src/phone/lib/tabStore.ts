/** The phone's tab row kept across a reload, and which tab a close fronts; pure over an injected store. Reference: docs/phone/settings-nav.md */

import type { BranchStatus } from "../../types";
import type { Browse, Stop } from "./trail";

/** The localStorage key, beside `baud-phone-project` (PhoneApp's PROJECT_KEY). */
export const TABS_KEY = "baud-phone-tabs";

/** The stored shape's version. A blob with any other is not read. */
export const TABS_VERSION = 1;

/** How many fronted keys the focus history keeps, so the list never grows for ever. */
export const FOCUS_CAP = 24;

const MODES = ["fresh", "resume", "shell", "watch", "file"] as const;

/** One pane as stored: PhoneApp's `OpenPane` fields so it reads back without a cast; `command` and `restored` are never stored. */
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

/** The tab row: panes in row order, the front tab, and the focus order (oldest first). */
export interface Tabs<P> {
  open: P[];
  active: string | null;
  focus: string[];
}

export type TabStorage = Pick<Storage, "getItem" | "setItem">;

/** A tab was fronted: `key` moves to the end of the focus history, capped at `FOCUS_CAP`. */
export function focusOn(focus: readonly string[], key: string): string[] {
  return [...focus.filter((held) => held !== key), key].slice(-FOCUS_CAP);
}

/** A tab was closed: the new front (most recently fronted, else rightmost) and the history without it; `keys` is the row before the close. */
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

function forStorage(pane: StoredPane): StoredPane {
  const { command: _command, restored: _restored, ...kept } = pane;
  return kept;
}

/** Write the tab row; a refusing storage (private mode, quota) loses the restore, never the session. */
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
    // The tabs on screen are untouched; only the next load will not find them.
  }
}

const isText = (value: unknown): value is string => typeof value === "string";
const optionalText = (value: unknown) => value === undefined || isText(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One stored pane checked field by field, or null; a hand-edited or older blob drops the pane, never the face. */
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

/** Read the tab row back, or null; panes are marked `restored`, and a stale `active` falls to the newest fronted, then the rightmost. */
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

function frontOf(keys: readonly string[], focus: readonly string[], wanted: unknown): string | null {
  if (isText(wanted) && keys.includes(wanted)) return wanted;
  const fronted = focus[focus.length - 1];
  if (fronted !== undefined) return fronted;
  return keys.length ? keys[keys.length - 1] : null;
}

/** Who is on the machine after load; a null list did not answer, and a pane is only dropped against a list that answered. */
export interface Census {
  seat: string;
  seated: readonly BranchStatus[] | null;
  roster: readonly BranchStatus[] | null;
}

/** Check restored panes against the census: agent panes take a fresh card or drop; an unanswered list keeps the pane on its stored card. */
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

/** Fold restored tabs into what hands opened meanwhile: hands win, and the face holds one agent seat (PhoneApp `focusPane`). */
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
