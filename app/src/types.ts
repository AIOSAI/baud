/** Mirrors `BranchStatus` in src-tauri/src/lib.rs. */
export interface BranchStatus {
  name: string;
  path: string;
  /** The project this branch belongs to — a roster card may not be the seat's. */
  project: string;
  is_citizen: boolean;
  /** Passport `identity.citizen_class` is "manager" — the project's owner. */
  manager: boolean;
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
