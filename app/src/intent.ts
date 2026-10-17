/** Operator intent that has to outlive a React remount: a hot reload re-arms every `useRef` guard.
 * sessionStorage holds the startup shot (this app run); localStorage holds ended rooms (until that card is opened).
 * Every read degrades to "no intent", every write is best effort. */

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

export function clearRoomEnded(project: string, branch: string): void {
  const key = roomKey(project, branch);
  const rooms = endedRooms();
  if (!rooms.includes(key)) return;
  writeEnded(rooms.filter((item) => item !== key));
}
