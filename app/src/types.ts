/** Mirrors `BranchStatus` in src-tauri/src/lib.rs. */
export interface BranchStatus {
  name: string;
  path: string;
  /** The project this branch belongs to — a roster card may not be the seat's. */
  project: string;
  is_citizen: boolean;
  manager: boolean;
  citizen_class: string;
  dispatched: boolean;
  interactive: boolean;
  has_history: boolean;
  resume_id: string | null;
  /** The own room's name whether or not it exists. Read it, never rebuild it: `room_name` owns the rule. */
  room: string;
  has_room: boolean;
  /** The own room exists AND holds a claude; only then does it silence outside_room. */
  own_room_live: boolean;
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
  /** Machine-wide on purpose: the terminal may sit in a room of a project the fleet view is not showing. */
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

/** One directory level; `path` is relative to the branch root and `truncated` says the server dropped the tail. */
export interface DirWindow {
  entries: DirEntryInfo[];
  truncated: boolean;
  /** The resolved root's absolute path (@api's `floor`). Absent on an older server, so copy refuses rather than pass a relative path. */
  floor?: string;
}

/** A row of @api's `/v1/roots` roster (phone-only, no Rust mirror). Echoed back verbatim, never built here. */
export interface RootEntry {
  kind: string;
  name: string;
  label: string;
}

/** Mirrors `FileText` in src-tauri/src/lib.rs. */
export interface FileText {
  path: string;
  content: string;
  truncated: boolean;
  /** Phone-only (@api's `floor`); the desktop's `path` is already the machine path. */
  floor?: string;
}

/** Mirrors `GitChanges` in src-tauri/src/lib.rs. */
export interface GitChanges {
  files: string[];
  count: number;
}

/** `/v1/git-changes` counts only (phone-only). `untracked` is not part of `count`. */
export interface GitChangeCount {
  count: number;
  untracked: number;
}

/** The whole `/v1/git-changes` envelope (phone-only). A separate shape so the mirrored `GitChanges` never names fields the desktop backend does not send. */
export interface GitChangeRows {
  branch: string;
  grain: string;
  files: string[];
  count: number;
  untracked: number;
  rows: GitRow[];
}

/** `status` is git's two-column code, raw: trimming it merges different answers. `phone/gitStatus.ts` is its one reader. */
export interface GitRow {
  path: string;
  status: string;
}

export interface GitFileDiff {
  branch: string;
  grain: string;
  staged: boolean;
  ref: string;
  path: string;
  bytes: number;
  truncated: boolean;
  diff: string;
}

export interface GitLog {
  branch: string;
  grain: string;
  commits: GitCommitRow[];
  count: number;
}

export interface GitCommitRow {
  sha: string;
  subject: string;
}

/** One commit from @api's `/v1/commit` (phone-only). No patch: the diff lane carries it one file at a time. */
export interface GitCommit {
  ref: string;
  sha: string;
  author: string;
  date: string;
  subject: string;
  message: string;
  files: GitCommitFile[];
  count: number;
}

export interface GitCommitFile {
  path: string;
  additions: number;
  deletions: number;
}

/** @api's `/v1/git-remote` (phone-only). Links come from `web` (`url` may be a path); no remote is a 200 with `remote: null`. */
export interface GitRemote {
  branch: string;
  grain: string;
  remote: string | null;
  url: string | null;
  web: string | null;
  redacted: boolean;
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
  /** The mail's address, top-level via @ai_mail's `extra`; the bell row opens the message only when both are set. */
  mail_id?: string;
  recipient?: string;
  /** Absent on older lines; the phone then finds the recipient in the census, then the roster. */
  project?: string;
}

/** @api's `/v1/feed` window (phone-only). `gap` means events were lost, and the face must show it. */
export interface FeedWindow {
  events: NotificationEvent[];
  cursor: string | null;
  gap: boolean;
  gap_reason: string | null;
  more: boolean;
}

/** A verb's answer (phone-only). `ok` is the server's judgment; `detail` is shown verbatim. */
export interface VerbResult {
  ok: boolean;
  detail: string | null;
}

export interface NewProjectResult {
  ok: boolean;
  name: string;
  project: string;
  target: string;
  template: string;
  agent: string;
  agent_home: string;
  detail: string;
}

/** Mirrors `CaptureOutcome` in lib.rs. Off the phone's path, kept while the struct is in the binary. */
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

/** Mirrors `SendOutcome`; kept for the same reason as {@link PaneCapture}. */
export interface SendResult {
  room: string | null;
  sent: boolean;
  detail: string | null;
  error: string | null;
}

/** Mirrors `AgentSettings` in src-tauri/src/settings.rs; null means the key is absent and claude decides. */
export interface AgentSettings {
  model: string | null;
  auto_compact_enabled: boolean | null;
  auto_compact_window: number | null;
}

/** Mirrors `AgentSettingsPatch`: absent leaves a key, null removes it, a value sets it. */
export interface AgentSettingsPatch {
  model?: string | null;
  auto_compact_enabled?: boolean | null;
  auto_compact_window?: number | null;
}

/** Per-project `.aipass/baud.settings.json`, stored opaque. Hook sounds stay out: their temp-dir flag file is the source of truth. */
export interface BaudSettings {
  startup_agent?: string | null;
  poll_interval_ms?: number;
  bell_max_events?: number;
  bell_sound?: boolean;
  /** Phone room scroll speed as a percent of TerminalSheet's built-in feel; absent means 100. */
  terminal_scroll_percent?: number;
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

/** Mirrors `MemoryConfig` in src-tauri/src/memory.rs; @memory owns the file. */
export interface MemoryConfig {
  /** Null when the phone read a route and touched no file. */
  path: string | null;
  /** False: the caps are documentation, not enforcement. Null: unknown, the phone's route does not say. */
  enforced: boolean | null;
  entry_limits: EntryLimit[];
  rollover: RolloverDial[];
  per_branch: BranchOverride[];
}

/** @skills' `machine_vitals()` via @api `GET /v1/machine` (no Rust mirror). `reason` is a string because the skill owns the codes. */
export interface MachineSection {
  available: boolean;
  reason: string | null;
  sentence: string | null;
  detail: string | null;
}

export interface MachineRange {
  min: number;
  max: number;
}

export interface MachineFanRow {
  chip: string | null;
  label: string | null;
  current: number | null;
  range: MachineRange | null;
  percent_of_range: number | null;
  reason: string | null;
  sentence: string | null;
  detail: string | null;
}

/** Every value key is present and null when unknown, never 0: a zero would invent a measurement. */
export interface MachineVitals {
  /** True on every 200 - a refusal arrives as a 503, not as `ok: false`. */
  ok: boolean;
  schema: number;
  sampled_at: string;
  cpu: MachineSection & {
    percent: number | null;
    window_s: number | null;
    /** Per online CPU, null while warming; this, not `logical`, sets the bar count. */
    cores: number[] | null;
    logical: number | null;
    physical: number | null;
    mhz: number | null;
    mhz_max: number | null;
  };
  load: MachineSection & { one: number | null; five: number | null; fifteen: number | null };
  memory: MachineSection & {
    total_bytes: number | null;
    used_bytes: number | null;
    available_bytes: number | null;
    percent: number | null;
  };
  swap: MachineSection & {
    total_bytes: number | null;
    used_bytes: number | null;
    free_bytes: number | null;
    percent: number | null;
  };
  temp: MachineSection & {
    chip: string | null;
    label: string | null;
    celsius: number | null;
    /** The SENSOR'S own lines - never a constant on this face. */
    high: number | null;
    critical: number | null;
    seen: string[] | null;
  };
  fan: MachineSection & {
    label: string | null;
    current: number | null;
    range: MachineRange | null;
    percent_of_range: number | null;
    fans: MachineFanRow[] | null;
    seen: string[] | null;
  };
  network: MachineSection & {
    sent_bytes_per_s: number | null;
    recv_bytes_per_s: number | null;
    window_s: number | null;
  };
  processes: MachineSection & { count: number | null };
  /** Optional: a schema-1 skill has no key, drawn as absent and never inferred. */
  battery?: MachineSection & {
    percent: number | null;
    plugged: boolean | null;
    state: "charging" | "discharging" | "full" | "unknown";
    seconds_left: number | null;
    low: number | null;
    critical: number | null;
  };
}

/** @skills' `machine_processes()` via @api `GET /v1/machine/processes`. `total` counts sleeping pids too, so it never reads as "running". */
export interface MachineProcesses {
  sampled_at: string;
  window_ms: number;
  total: number;
  sort: "cpu";
  processes: {
    pid: number;
    name: string;
    cpu_pct: number;
    mem_pct: number;
    mem_mb: number;
    user: string | null;
    state: string;
  }[];
}

/** @skills' `lock_state()` via @api `GET /v1/lock`. `ok: false` is a 200 meaning could-not-tell: drawn unknown, never unlocked. */
export interface LockState {
  ok: boolean;
  locked: boolean | null;
  method: string | null;
  session: string | null;
  reason: string | null;
  detail: string | null;
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

/* @backup's and @api's shapes (phone-only), see docs/phone/backup.md. Change with the host's answer. */

export type BackupLane = "snapshot" | "versioned" | "all" | "drive_sync";

export interface BackupLaneStatus {
  last: string | null;
  files: number | null;
}

/** A lane's progress; null on the entry while the lane is still scanning. */
export interface BackupProgress {
  done: number;
  total: number;
  failed: number;
  bytes_done: number;
  bytes_total: number | null;
  current: string | null;
  updated_at: string;
}

/** One lane in flight. `verb` is what a press matches; `lane` is the current sub-lane under `all`. */
export interface BackupRunning {
  job: string | null;
  verb: BackupLane;
  lane: BackupLane;
  pid: number;
  started_at: string;
  progress: BackupProgress | null;
}

/** `GET /v1/backup/status`: @backup's `status --json`, plus @api's `running`. */
export interface BackupStatus {
  project: string;
  root: string;
  registered: boolean;
  mode: string;
  drive_sync: boolean;
  runs: number;
  lanes: {
    snapshot: BackupLaneStatus;
    versioned: BackupLaneStatus;
    drive_sync: BackupLaneStatus;
  };
  /** Present only when asked with sizes=1: the walk takes seconds. */
  store?: {
    snapshots_bytes: number;
    versioned_bytes: number;
  };
  drive: { tracked_files: number };
  running: BackupRunning[];
}

/** `POST /v1/backup/run` (202, state running) and `GET /v1/backup/job`. */
export interface BackupJob {
  job: string;
  project: string;
  lane: BackupLane;
  /** stopped is exit 130 (a stop request); failed is any other non-zero exit or a routing error. */
  state: "running" | "done" | "stopped" | "failed";
  started_at: string;
  finished_at?: string | null;
  exit?: number | null;
  summary?: string | null;
  error?: string | null;
}

export interface BackupCancel {
  project: string;
  lane: BackupLane;
  stopped: boolean;
  message: string;
}
