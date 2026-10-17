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
  /**
   * This branch's own room, named whether or not it exists — `baud-<branch>`
   * in the anchor, `baud-<project>-<branch>` elsewhere, tmux-sanitized. The
   * name a live room HAS and the name a launch would CREATE are one string;
   * `has_room` says which you are looking at, and `outside_room` names the
   * session a door acts on when the own room holds no claude - absent, or a
   * shell waiting (ruled B, 2026-09-07: an empty room never outranks a seat).
   *
   * Read it, never rebuild it: the derivation lives in `room_name` and this
   * field exists so no second copy of that rule has to.
   */
  room: string;
  has_room: boolean;
  /** The own room exists AND holds a claude. Only then does it silence outside_room (ruled B, 2026-09-07). */
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
  /**
   * WHERE THIS LEVEL STANDS ON THE MACHINE (FPLAN-0443 rider) - the absolute
   * path of the resolved root, @api's `floor`, carried through the seam under
   * its own name. Every `path` above is relative to exactly this, so the two
   * together are the only way this face can name a file to a person.
   *
   * OPTIONAL, AND THE ABSENCE MEANS SOMETHING RATHER THAN NOTHING: a server
   * that has not learned the key yet leaves it undefined, and the copy button
   * refuses out loud rather than handing over a relative path dressed as a
   * machine one.
   */
  floor?: string;
}

/**
 * ONE PLACE THE FILE LANE CAN STAND - a row of @api's `/v1/roots` roster
 * (FPLAN-0443). PHONE-ONLY: the desktop resolves under the project it is
 * seated in and has no roster behind it.
 *
 * MIRRORS NO RUST STRUCT, deliberately, and it is the first type here that
 * does not. Roots are a property of the FENCE, and the fence is @api's - so
 * this shape follows their door rather than a struct in `lib.rs`. The day the
 * desktop wants roots it is the same roster behind a different transport, and
 * this is the type it will use.
 *
 * THE FACE NEVER CONSTRUCTS ONE. `kind` and `name` come back from the server
 * and are echoed to it verbatim on the next request; a roster the phone
 * hardcoded would be a roster that lies the day a project is added. That is
 * the whole reason the door exists rather than a constant.
 */
export interface RootEntry {
  /** `branch` | `home` | `project` | `aipass` - the fence's own vocabulary. */
  kind: string;
  /** The name WITHIN that kind, empty where the kind names nothing. */
  name: string;
  /** What the row prints. Falls back to `name`, then to `kind`, when absent -
   *  a missing label costs a nicer word and never a missing root. */
  label: string;
}

/** Mirrors `FileText` in src-tauri/src/lib.rs. */
export interface FileText {
  path: string;
  content: string;
  truncated: boolean;
  /**
   * WHERE THE FILE STANDS ON THE MACHINE - @api's `floor` for the root this
   * read resolved against (FPLAN-0443 rider).
   *
   * PHONE-ONLY AND OPTIONAL, and the struct this mirrors has no such field on
   * purpose: the desktop's `path` already IS the machine path, so it never
   * needed a floor to build one. Undefined here is the desktop, or a server
   * that has not shipped the key.
   */
  floor?: string;
}

/** Mirrors `GitChanges` in src-tauri/src/lib.rs. */
export interface GitChanges {
  files: string[];
  count: number;
}

/**
 * THE SAME QUESTION WITH NOTHING ATTACHED - @api's `/v1/git-changes` read for
 * its two numbers alone (DPLAN-0305). PHONE-ONLY.
 *
 * It exists because two of this face's pollers ask for a change count and
 * nothing else, and both were being answered with the whole list: the wheel's
 * badge sweep (one branch every five seconds, forever) reads `count` and threw
 * the file names away, and the git app's repo badge read `rows.length` and
 * threw the rows away. The wire still carries them - dropping the payload is
 * @api's `count_only` to add, not this face's to invent - but nothing is
 * MATERIALISED here for a number to be lifted out of.
 *
 * `untracked` rides alongside rather than folded in, exactly as the server
 * keeps it: `count` is what differs from HEAD and untracked files are not part
 * of that, so a caller that wants every changed path adds the two and a caller
 * that wants the tracked count does not.
 */
export interface GitChangeCount {
  count: number;
  untracked: number;
}

/**
 * The git-changes envelope WHOLE - @api's `/v1/git-changes` (DPLAN-0303).
 * PHONE-ONLY, and a second shape rather than a wider `GitChanges` on purpose.
 *
 * `GitChanges` above mirrors a Rust struct and is the BADGE's question: how
 * many tracked files differ from HEAD, in exactly the desktop's semantics. This
 * is the git APP's question, which needs three things that contract does not
 * carry - the grain it was measured at, git's own code per row, and untracked
 * files by name. Widening the mirrored struct would have made the desktop's
 * type describe fields the desktop's backend never sends.
 *
 * `rows` is the complete answer and `files` is the tracked subset of it, which
 * is why the app renders rows and the badge sweep still reads count: two
 * questions, one read, neither one deciding for the other.
 */
export interface GitChangeRows {
  branch: string;
  /** `branch` (one citizen's subtree) or `repo` (every branch, one tree). */
  grain: string;
  /** Tracked paths that differ from HEAD - the desktop card's list. */
  files: string[];
  count: number;
  /** How many untracked paths ride in `rows` and not in `files`. */
  untracked: number;
  rows: GitRow[];
}

/**
 * One changed path with git's own two-column code beside it.
 *
 * The code arrives RAW and UNSTRIPPED - index column then worktree column -
 * because trimming it collapses answers that are not the same answer. See
 * `phone/gitStatus.ts`, which is the one place that reads it.
 */
export interface GitRow {
  path: string;
  status: string;
}

/**
 * One file's patch as unified diff TEXT - @api's `/v1/diff`. PHONE-ONLY.
 *
 * The desktop's `git_diff_text` answers a `FileText`, which is a whole branch's
 * patch under a path-shaped name. This lane is narrower and says more: one
 * file's block, the byte size it really was, and whether the server capped it.
 * A face that only had the text could not tell a short patch from a cut one.
 */
export interface GitFileDiff {
  branch: string;
  grain: string;
  staged: boolean;
  /** The commit this patch was read from, or "" for the working tree. */
  ref: string;
  path: string;
  bytes: number;
  truncated: boolean;
  diff: string;
}

/**
 * The repository's recent commits - @api's `/v1/git-log`. PHONE-ONLY.
 *
 * ALWAYS REPO GRAIN, and the envelope says so rather than leaving it implied:
 * the branch names WHICH repository, never which history. A row carries a short
 * object name and a subject and NOTHING else - that is the log door's whole
 * output, and the alternative is fifty subprocesses dragging fifty patches to
 * decorate a list.
 */
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

/**
 * One commit's facts and its per-file stats - @api's `/v1/commit`. PHONE-ONLY.
 *
 * NO PATCH, by design. The patch rides the diff lane one file at a time, so a
 * phone never loads a whole commit at once.
 */
export interface GitCommit {
  /** What was asked for - a sha, a tag, HEAD~2. `sha` is what it resolved to. */
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

/**
 * The repository's remote - @api's `/v1/git-remote`. PHONE-ONLY.
 *
 * ALWAYS REPO GRAIN, and the envelope says so in its own field: a remote
 * belongs to the repository, never to a branch, so the branch names WHICH
 * repository exactly as it does on the log and commit lanes.
 *
 * TWO ADDRESSES, NOT ONE, and the difference is the whole reason a link can be
 * honest. `url` is what is configured - possibly `git@host:owner/repo.git`,
 * possibly a directory on this disk. `web` is a form a person can OPEN, which
 * only some remotes have; the server answers null for the rest rather than
 * putting a scheme in front of a filesystem path and calling it a page. So a
 * face builds its links out of `web` and shows `url` as the fact it is.
 *
 * NO REMOTE IS AN ANSWER, NOT A REFUSAL (contract C-D, DPLAN-0414 C#12). A
 * repository with no remote configured answers 200 with `remote: null` and the
 * link fields null or absent; only a repository that cannot be read at all is
 * still refused. Until @api lands that, the old refusal arrives instead, and
 * the face reads both.
 */
export interface GitRemote {
  branch: string;
  grain: string;
  /** Which remote answered - `origin` by convention, its own name otherwise.
   *  Null when the repository has no remote configured (contract C-D). */
  remote: string | null;
  /** As configured, with any password already replaced on the server. Null
   *  or absent when there is no remote. */
  url: string | null;
  /** A browsable address, or null when this remote has no page at all. */
  web: string | null;
  /** True when a credential was taken out of `url` before it was sent. */
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
  /**
   * A MAIL EVENT'S ADDRESS (DPLAN-0414 contract C-A). @ai_mail stamps both
   * through `send_notification`'s `extra`, which merges them into the event
   * at its top level: `mail_id` is the message's `id` in the recipient's
   * `.ai_mail.local/inbox.json`, and `recipient` is that branch's name with no
   * `@`. Optional, and absent on every wake, dispatch and older mail line -
   * the phone's bell row is a door to the message only when both are here.
   * The desktop's Rust struct does not carry them and does not need to.
   */
  mail_id?: string;
  recipient?: string;
  /**
   * The recipient's PROJECT, as the project registry names it (C-A as amended
   * 2026-10-16 14:58). When present the phone reads that project's inbox
   * directly; when absent (any line written before the amendment) it falls
   * back to finding the recipient in the seated census, then the roster.
   */
  project?: string;
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

/** The host's answer to a new project: where it landed and its manager's branch. */
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
  /**
   * How fast a finger-pan scrolls the terminal room, as a PERCENT of the
   * face's built-in feel: 100 is that feel exactly, 200 is twice as far per
   * swipe, 50 is half. Absent means 100 - and it must, because the constants
   * this scales (`LINES_PER_NOTCH`, `PAN_ACCELERATION` in the phone's
   * TerminalSheet) are the neutral baseline the knob was cut from, not a
   * default the knob replaces.
   *
   * PHONE-CONSUMED, and only the phone edits it today: the room is scrolled by
   * a thumb there, while the desk has a wheel its OS already tunes. It lives in
   * this shared document anyway rather than in the phone's localStorage,
   * because BAUD's settings file is the one place an operator's preference is
   * written down, hand-editable, and survives a cache clear.
   */
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

/**
 * Mirrors `MemoryConfig` in src-tauri/src/memory.rs - @memory's own config
 * file, which BAUD renders and edits but does not own (m13).
 */
export interface MemoryConfig {
  /** The config file's path. Null when the face that read it touched no file
   *  (the phone reads a route), so there is no path row to draw. */
  path: string | null;
  /** False = the caps are documentation, not enforcement. Say so, never imply teeth.
   *  Null = UNKNOWN: the phone's route says nothing about the hook, so the
   *  panel says nothing either (DPLAN-0414 A#6). The desktop always knows. */
  enforced: boolean | null;
  entry_limits: EntryLimit[];
  rollover: RolloverDial[];
  per_branch: BranchOverride[];
}

/* ---------------------------------------------------------- the machine -- */

/**
 * Mirrors the dict @skills' `machine_vitals()` publishes (`lib/system_status/
 * handler.py`), which @api serves verbatim on `GET /v1/machine` (FPLAN-0561).
 * NOT a Rust struct - the desktop has no command behind this name - and NOT a
 * place any meaning lives: which sensor is the CPU and what an absence is
 * called are the skill's, and its README section "machine_vitals() - The
 * Published Read" is the source this is kept against.
 *
 * Every section carries these four beside its values. `reason` is one of the
 * skill's codes - platform, no_sensor, no_allowlisted_sensor, read_failed,
 * warming, no_range - typed as a string because the set is the skill's, and a
 * code it adds next month must arrive as itself rather than as a type error.
 */
export interface MachineSection {
  available: boolean;
  reason: string | null;
  /** The skill's own sentence for `reason` - the words the face prints. */
  sentence: string | null;
  /** The specifics (an exception, a recipe), when there are any. */
  detail: string | null;
}

/** A fan's rpm floor and ceiling, read from sysfs by the skill (Linux only). */
export interface MachineRange {
  min: number;
  max: number;
}

/** One row of `fan.fans[]` - every fan the allowlist admits, not only the headline one. */
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

/**
 * The whole reading. EVERY value key is always present, and null when the host
 * cannot give it - NEVER 0. A face that turns one of these nulls into a zero has
 * invented a measurement.
 */
export interface MachineVitals {
  /** True on every 200 - a refusal arrives as a 503, not as `ok: false`. */
  ok: boolean;
  schema: number;
  /** ISO-8601 UTC. @api caches for 1 s, so this can trail the request by that much. */
  sampled_at: string;
  cpu: MachineSection & {
    percent: number | null;
    window_s: number | null;
    /** Busy percent per ONLINE logical CPU, in index order, over the same window
     *  as `percent` - null while warming, never a list with holes. One bar per
     *  entry: this, not `logical`, is how many bars there are. */
    cores: number[] | null;
    /** The CONFIGURED counts - instant, so present even while warming. */
    logical: number | null;
    physical: number | null;
    /** The package clock now and its ceiling, in MHz. Null when the host has no
     *  cpu_freq; the section stays available and `detail` says why. */
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
    /** The chips reported when none was on the allowlist. */
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
  /**
   * The battery (schema 2, 2026-10-12). OPTIONAL because a skill that answers
   * schema 1 has no such key: the face draws that as absent and says so, and
   * never infers a battery from a missing key.
   */
  battery?: MachineSection & {
    /** Charge, 0-100. */
    percent: number | null;
    plugged: boolean | null;
    state: "charging" | "discharging" | "full" | "unknown";
    /** A real count only. Null on mains (unlimited) or when unknown; `detail` says which. */
    seconds_left: number | null;
    /** The host's published lines in percent (UPower), or null when none is published. */
    low: number | null;
    critical: number | null;
  };
}

/**
 * The process list (DPLAN-0414 contract C-B): @skills' `machine_processes()`,
 * relayed verbatim by @api on `GET /v1/machine/processes?limit=N`. Not a Rust
 * struct - the desktop sits on the machine and has no command behind the name.
 *
 * `total` is EVERY pid the skill saw, sleeping ones included - the same figure
 * as `processes.count` on the vitals, which is why the sheet calls it
 * "processes" and never "running". `processes` is the top `limit` by
 * `cpu_pct`, ties by `mem_pct`; `cpu_pct` is a real sample taken over
 * `window_ms`, normalised to the whole machine. `name` is the process name
 * only - never arguments - and may be empty, in which case the sheet shows the
 * pid. `user` is null when the host was denied it.
 */
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

/**
 * Mirrors the dict @skills' `lock_state()` publishes (`lib/screen_lock`), relayed
 * verbatim by @api on `GET /v1/lock` (FPLAN-0585). Not a Rust struct, and not a
 * place any meaning lives: which reader answered and what "cannot tell" is
 * called are the skill's.
 *
 * `ok` and `locked` AGREE - @api refuses any body where they do not, so a
 * `locked: false` can never ride an `ok: false`. `ok: false` is still a 200: the
 * machine answered that it COULD NOT TELL, and `locked` is null. That is drawn as
 * unknown, never as unlocked.
 */
export interface LockState {
  ok: boolean;
  /** True locked, false unlocked, null when the machine could not tell. */
  locked: boolean | null;
  /** Which read answered: "loginctl" or "dbus". */
  method: string | null;
  session: string | null;
  /** When `ok` is false: no_session, no_reader or read_failed - the skill's codes. */
  reason: string | null;
  /** The skill's own sentence, on answers too: "The screen is unlocked, per logind session 3." */
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

/* ------------------------------------------------------------ backup -- */
/* THE BACKUP DOOR. Not a Rust mirror: these are @backup's and
   @api's shapes, phone-only, described in docs/phone/backup.md.
   Field for field with the host's answer; change both together. */

/** The four lanes on the wire, exactly the drone verbs' names. */
export type BackupLane = "snapshot" | "versioned" | "all" | "drive_sync";

/** One lane's last run. Both null when the lane never ran. */
export interface BackupLaneStatus {
  last: string | null;
  files: number | null;
}

/**
 * A lane's progress, as the lane itself writes it at most once a second
 * (DPLAN-0412). Null on the entry while the lane is still scanning.
 */
export interface BackupProgress {
  /** File counts. */
  done: number;
  total: number;
  failed: number;
  /** What has been copied or uploaded so far. */
  bytes_done: number;
  /** The planned bytes, or null when the lane does not know them. */
  bytes_total: number | null;
  /** The file in flight, as the lane names it; null before the first file. */
  current: string | null;
  updated_at: string;
}

/**
 * One lane in flight, from @backup's running files (DPLAN-0412), so it lists
 * runs started from a terminal or by the daemon as well as the phone's own.
 *
 * `verb` is what was invoked and is what a press matches on; `lane` is the work
 * being done right now, which under `all` is each sub-lane in turn.
 */
export interface BackupRunning {
  /** @api's job id when this server started the run, null otherwise. */
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
  /** False for a root with no `.backup/` store: every `last` null, `runs` 0. */
  registered: boolean;
  mode: string;
  /** The project's Drive setting: `all` runs the Drive step only when on. */
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
  /** done is exit 0; stopped is exit 130, the lane ending on a stop request
   *  (DPLAN-0412); failed is any other non-zero exit, a timeout, or a routing
   *  error mid-run. */
  state: "running" | "done" | "stopped" | "failed";
  started_at: string;
  /** The job read only, once the run ends. */
  finished_at?: string | null;
  exit?: number | null;
  /** The command's last lines, verbatim, at most ~600 chars. */
  summary?: string | null;
  error?: string | null;
}

/** `POST /v1/backup/cancel` (200, DPLAN-0412). `message` is @backup's own line. */
export interface BackupCancel {
  project: string;
  lane: BackupLane;
  stopped: boolean;
  message: string;
}
