/**
 * Operator intent that has to outlive a React remount.
 *
 * `npm run tauri dev` is where BAUD is developed AND where it is used - the
 * operator's live seat is a dev window - so every frontend save hot-reloads
 * the module graph: App unmounts, mounts again, and every `useRef` guard
 * inside it is born fresh. A guard that means "the operator already decided
 * this" cannot live in a ref. It lives here.
 *
 * That gap is what let an ended room resurrect itself (Patrick-caught
 * 2026-08-12): end room killed the session at 18:27, a frontend save
 * remounted App, the once-per-app-run startup agent re-armed, saw its branch
 * roomless, and relaunched it with `-c` at 18:28. Patrick's ruling: an ended
 * room stays dead until HE resumes it - a card click, or a fresh chat.
 *
 * Two storages, two lifetimes, on purpose:
 *
 * - `sessionStorage` = this app RUN. Survives hot reloads, dies with the
 *   window. The startup agent's one shot belongs here: it fires when BAUD
 *   opens, not every time a file is saved.
 * - `localStorage` = until the operator says otherwise. An ended room stays
 *   dead across relaunches too, because in dev a Rust edit restarts the whole
 *   app - if the mark died with the window, the ruling would hold for about a
 *   minute. The ONE door that clears it is the operator opening that card.
 *
 * Storage can throw (a webview with storage disabled, a full quota). Every
 * read degrades to "no intent recorded" - the pre-m12 behaviour - and every
 * write is best-effort. Losing a preference must never take the window down.
 */

/** The startup agent's one shot, spent for this app run. */
const STARTUP_KEY = "baud.startup.spent";

/** Rooms the operator ended: `["<project>/<branch>", …]`. */
const ENDED_KEY = "baud.rooms.ended";

/** Per project, because rooms are: two projects have their own `<branch>`. */
function roomKey(project: string, branch: string): string {
  return `${project}/${branch}`;
}

function endedRooms(): string[] {
  try {
    const raw = window.localStorage.getItem(ENDED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Hand-edited or half-written storage reads as empty, never as a crash.
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeEnded(rooms: string[]): void {
  try {
    window.localStorage.setItem(ENDED_KEY, JSON.stringify(rooms));
  } catch {
    /* best effort - the mark is a courtesy, not a lock */
  }
}

/** Has the startup agent already had its shot this app run? */
export function startupSpent(): boolean {
  try {
    return window.sessionStorage.getItem(STARTUP_KEY) === "1";
  } catch {
    return false;
  }
}

/** Spend the shot. Called whatever the outcome - one attempt per app run. */
export function spendStartup(): void {
  try {
    window.sessionStorage.setItem(STARTUP_KEY, "1");
  } catch {
    /* best effort - see the module note */
  }
}

/** Did the operator end this branch's room, with no click on it since? */
export function roomEnded(project: string, branch: string): boolean {
  return endedRooms().includes(roomKey(project, branch));
}

/** Record an ended room. Only ever called after tmux confirms the kill. */
export function markRoomEnded(project: string, branch: string): void {
  const key = roomKey(project, branch);
  const rooms = endedRooms();
  if (rooms.includes(key)) return;
  writeEnded([...rooms, key]);
}

/** The operator opened this card: the room is theirs again, mark cleared. */
export function clearRoomEnded(project: string, branch: string): void {
  const key = roomKey(project, branch);
  const rooms = endedRooms();
  if (!rooms.includes(key)) return;
  writeEnded(rooms.filter((item) => item !== key));
}
