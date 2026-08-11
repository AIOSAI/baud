/** Mirrors `BranchStatus` in src-tauri/src/lib.rs. */
export interface BranchStatus {
  name: string;
  path: string;
  is_citizen: boolean;
  dispatched: boolean;
  interactive: boolean;
  has_history: boolean;
  resume_id: string | null;
  has_room: boolean;
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
}
