/** Mirrors `BranchStatus` in src-tauri/src/lib.rs. */
export interface BranchStatus {
  name: string;
  path: string;
  /** The project this branch belongs to — a roster card may not be the seat's. */
  project: string;
  is_citizen: boolean;
  /** Passport `identity.citizen_class` is "manager" — the project's owner. */
  manager: boolean;
  /**
   * That same `identity.citizen_class` verbatim, empty when the passport is
   * missing or unreadable. `manager` is this field asked one question; this is
   * the whole answer, so the passport can print the class and a class AIPass
   * adds later needs no second trip through this file.
   */
  citizen_class: string;
  dispatched: boolean;
  interactive: boolean;
  has_history: boolean;
  resume_id: string | null;
  has_room: boolean;
  outside_room: string | null;
  subagents: number;
  new_mail: number;
  opened_mail: number;
  active_plans: number;
  todo_count: number;
  summary: string;
  last_updated: string;
}

/** Mirrors `FleetSnapshot` in src-tauri/src/lib.rs. */
export interface FleetSnapshot {
  project: string;
  root: string;
  generated_at: string;
  error: string | null;
  branches: BranchStatus[];
  /**
   * Every tmux session holding a live INTERACTIVE claude, machine-wide and
   * deliberately not scoped to the seat - the terminal may be attached to a
   * room belonging to a project the fleet view is not showing (m13).
   */
  live_agent_sessions: string[];
}

/** Mirrors `ProjectListing` in src-tauri/src/lib.rs. */
export interface ProjectListing {
  name: string;
  root: string;
  anchor: boolean;
  active: boolean;
}

/** Mirrors `DirEntryInfo` in src-tauri/src/lib.rs. */
export interface DirEntryInfo {
  name: string;
  path: string;
  is_dir: boolean;
}

/**
 * One directory level with its honesty flag — the phone transport's shape,
 * same idea as FeedWindow below. `path` here is RELATIVE to the branch root
 * (the phone's fence takes names, never machine paths), and `truncated` says
 * the server dropped the tail of an over-full level rather than letting a
 * shorter list read as the whole one.
 */
export interface DirWindow {
  entries: DirEntryInfo[];
  truncated: boolean;
}

/** Mirrors `FileText` in src-tauri/src/lib.rs. */
export interface FileText {
  path: string;
  content: string;
  truncated: boolean;
}

/** Mirrors `GitChanges` in src-tauri/src/lib.rs. */
export interface GitChanges {
  files: string[];
  count: number;
}

/** Mirrors `SpawnResult` in src-tauri/src/pty.rs. */
export interface SpawnResult {
  id: string;
  created: boolean;
  room: string | null;
}

/** Mirrors `NotificationEvent` in src-tauri/src/notifications.rs. */
export interface NotificationEvent {
  ts: string;
  kind: string;
  title: string;
  body: string;
  source: string;
}

/**
 * One window of the feed, cursor and all - @api's `/v1/feed` envelope
 * (FPLAN-0413 phase 3b). PHONE-ONLY: this shape has no Rust counterpart,
 * because the desktop reads the feed file directly and has no cursor to keep.
 *
 * `gap` is the field that matters. The server re-delivers the boundary event on
 * purpose - at-least-once, since a dropped alert is worse than a duplicate - but
 * when the feed was trimmed past what the caller had seen, no cursor can hide
 * that events were lost. It says so, and the face has to show it rather than
 * quietly render a shorter list.
 */
export interface FeedWindow {
  events: NotificationEvent[];
  cursor: string | null;
  gap: boolean;
  gap_reason: string | null;
  more: boolean;
}

/**
 * What a verb answers with (FPLAN-0413 phase 6). PHONE-ONLY.
 *
 * `ok` is the server's judgment, not the client's hope: a chip turns green
 * because the machine said the thing happened, never because the request left.
 * `detail` is a human sentence to show verbatim - the same discipline the read
 * lane already follows with @api's error envelope.
 */
export interface VerbResult {
  ok: boolean;
  detail: string | null;
}

/**
 * One room's screen as the binary read it. Mirrors `CaptureOutcome` in lib.rs.
 *
 * NOT ON THE PHONE'S PATH ANY MORE. Amendment 1 cut the repaint design this
 * served; the phone attaches a real client instead. Kept because `--capture-room`
 * is still IN the shipped binary and this file's contract is to mirror the Rust
 * structs - deleting the mirror while the struct lives would be the drift
 * `types.ts` exists to prevent. Goes when @devpulse rules on the flag.
 */
export interface PaneCapture {
  project: string;
  branch: string;
  room: string | null;
  pane: string;
  cols: number;
  rows: number;
  captured: boolean;
  detail: string | null;
  generated_at: string;
  error: string | null;
}

/**
 * What one keystroke or one paste answered with. Mirrors `SendOutcome`.
 *
 * Same standing as {@link PaneCapture}: off the phone's path since Amendment 1,
 * still mirroring a struct that is still in the binary. The property it records
 * outlived it - text is typed without a newline, so running a command stays a
 * second deliberate act, and that is now a property of the byte stream instead.
 */
export interface SendResult {
  room: string | null;
  sent: boolean;
  detail: string | null;
  error: string | null;
}

/** Mirrors `AgentSettings` in src-tauri/src/settings.rs - null means the key
 *  is absent from the file, which is a real state: claude decides. */
export interface AgentSettings {
  model: string | null;
  auto_compact_enabled: boolean | null;
  auto_compact_window: number | null;
}

/**
 * Mirrors `AgentSettingsPatch` - three states per field, so "leave it alone"
 * and "unset it" can never be confused:
 *   absent -> the key is not touched
 *   null   -> the key is REMOVED from the file
 *   value  -> the key is set
 */
export interface AgentSettingsPatch {
  model?: string | null;
  auto_compact_enabled?: boolean | null;
  auto_compact_window?: number | null;
}

/**
 * BAUD's own interface settings (m11 phase 6), per project in
 * `.aipass/baud.settings.json`. The backend stores this document OPAQUE - it
 * merges keys and hands them back - so this shape is the frontend's contract
 * with itself, and every key is optional because "absent" is the honest state
 * of a file nobody has saved yet. `interfacePrefs` in InterfaceSettings.tsx is
 * the one place absence (or a hand-edited nonsense value) becomes a default.
 *
 * Hook sounds are deliberately NOT here: their flag file in the temp dir is
 * the single source of truth, and a mirror would drift the moment @hooks or
 * another window flipped it.
 */
export interface BaudSettings {
  /** Branch name to open a seat for at startup; null/absent = open nothing. */
  startup_agent?: string | null;
  /** Fleet snapshot and bell poll cadence, milliseconds. */
  poll_interval_ms?: number;
  /** How many feed events the bell keeps - reader-side, the feed is ai_mail's. */
  bell_max_events?: number;
  /** Chime when a poll brings genuinely new events. */
  bell_sound?: boolean;
}

/** Mirrors `EntryLimit` in src-tauri/src/memory.rs. */
export interface EntryLimit {
  key: string;
  file: string;
  container: string;
  field: string;
  max_chars: number;
}

/** Mirrors `RolloverDial` in src-tauri/src/memory.rs. */
export interface RolloverDial {
  group: string;
  key: string;
  count: number;
  /** Absent on disk means BAUD will not create it. */
  auto_compact_cap: number | null;
}

/** Mirrors `BranchOverride` in src-tauri/src/memory.rs. */
export interface BranchOverride {
  branch: string;
  dials: RolloverDial[];
}

/**
 * Mirrors `MemoryConfig` in src-tauri/src/memory.rs - @memory's own config
 * file, which BAUD renders and edits but does not own (m13).
 */
export interface MemoryConfig {
  path: string;
  /** False = the caps are documentation, not enforcement. Say so, never imply teeth. */
  enforced: boolean;
  entry_limits: EntryLimit[];
  rollover: RolloverDial[];
  per_branch: BranchOverride[];
}

/** Mirrors `MemoryConfigPatch` in src-tauri/src/memory.rs. */
export interface MemoryConfigPatch {
  caps: { key: string; max_chars: number }[];
  rollover: {
    group: string;
    key: string;
    count?: number;
    auto_compact_cap?: number;
  }[];
}
