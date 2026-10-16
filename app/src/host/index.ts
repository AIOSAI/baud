/**
 * The host surface - every capability the frontend can ask the machine for,
 * named once, typed once (FPLAN-0412 phase 2).
 *
 * Components import from here, never from `@tauri-apps`. What they get is a
 * function with a real signature instead of a string and a bag of arguments,
 * so a renamed backend command or a changed parameter breaks the build in one
 * place rather than failing at runtime in fourteen.
 *
 * TERMINAL-AGNOSTIC (Patrick's standing ruling, 2026-08-14): these verbs name
 * what BAUD does - open a pty, read a file, end a room - never what one
 * terminal's flags are called. AIPass does the work, BAUD is the face, and the
 * terminal is a component in a slot. `ptyCreate` runs whatever command line its
 * caller composed; the choice of terminal lives at that one call site in
 * App.tsx, and nothing in this file knows the word "claude".
 *
 * The desktop-only verbs are marked. They are the ones the phone face replaces
 * rather than binds - noted here so the next face knows what it is inheriting
 * and what it is not.
 */

import type {
  AgentSettings,
  AgentSettingsPatch,
  BackupCancel,
  BackupJob,
  BackupLane,
  BackupStatus,
  BaudSettings,
  BranchStatus,
  DirEntryInfo,
  DirWindow,
  GitChangeCount,
  FeedWindow,
  FileText,
  FleetSnapshot,
  GitChangeRows,
  GitChanges,
  GitCommit,
  GitFileDiff,
  GitLog,
  GitRemote,
  LockState,
  MachineVitals,
  MemoryConfig,
  NotificationEvent,
  ProjectListing,
  RootEntry,
  SpawnResult,
  VerbResult,
} from "../types";
import { call } from "./transport";

export { HostChannel, openExternal } from "./transport";

/* ---------------------------------------------------------------- fleet -- */

/** The seated project's cards plus the scan every card was read from.
 *  `project` names a census entry to read instead of the seat - the phone's
 *  switcher passes it; the desktop, whose seat lives in the backend, never
 *  does (and the argument is omitted entirely so the Tauri command's
 *  signature is untouched). */
export const fleetSnapshot = (project?: string) =>
  project ? call<FleetSnapshot>("fleet_snapshot", { project }) : call<FleetSnapshot>("fleet_snapshot");

/** Every project's citizens, for the roster tabs - one sweep, not one per card. */
export const agentRoster = () => call<BranchStatus[]>("agent_roster");

/* ----------------------------------------------------------- the machine -- */

/** The machine's vitals, for the phone's monitor layer (FPLAN-0561). NO
 *  ARGUMENTS, EVER: the route refuses any query parameter, a cache-buster
 *  included, and passing none is also what keeps the generic project lift in
 *  the http transport from adding one. The server's own 1 s cache is what
 *  keeps any number of phones at one read. */
export const machineVitals = () => call<MachineVitals>("machine_vitals");

/** Whether the machine's screen is locked - the header lock chip's read
 *  (FPLAN-0585). READ scope, because a lock's position is observation; locking
 *  it stays `verbLock` under operate. No arguments, ever, for the same reason as
 *  the machine read above. */
export const lockState = () => call<LockState>("lock_state");

/* -------------------------------------------------------------- projects -- */

export const listProjects = () => call<ProjectListing[]>("list_projects");

export const projectSwitch = (name: string) => call<void>("project_switch", { name });

/* ------------------------------------------------------------ read lane -- */

/** Fenced: the backend resolves under the seated project - callers pass names. */
export const listDir = (path: string) => call<DirEntryInfo[]>("list_dir", { path });

/**
 * THE OPTIONAL `project` ON THE THREE READS BELOW, and why it is not a desktop
 * change (2026-08-16, browsing-is-free ruling).
 *
 * Patrick ruled browsing free: any agent's files, any project, no restriction.
 * The host API's read routes now take a project and resolve it through @baud's
 * own census; the fleet route always did. The desktop needs nothing - its
 * backend resolves under the seat it is already sitting in - so the argument is
 * threaded ONLY when a caller supplies one, and the key is left off the payload
 * entirely otherwise. The desktop passes none, so the object handed to `invoke`
 * is byte-identical to what it was before this line existed. One seam, two
 * faces, and the face that needed a new capability is the only one that changed.
 */

/**
 * THE OPTIONAL `root` ON THE TWO READS BELOW (FPLAN-0443, 2026-08-18) - the
 * same threading as `project` above, for the same reason and with the same
 * discipline.
 *
 * Patrick, 2026-08-18: "rn I can only see into agent files... I cant explore
 * home. or project files outside agents." The fence answered one kind of word -
 * a citizen name - so agent-land was the whole of where a phone could stand.
 * It now answers four (`branch`, `home`, `project`, `aipass`), and `root` is
 * which kind of word the first component of `path` is.
 *
 * ABSENT MEANS BRANCH, which is not a default this seam invented: it is the
 * only meaning these two verbs have ever had, so a browse written before roots
 * existed sends the request it always sent. The key is left off the payload
 * entirely, so the desktop's `invoke` object stays byte-identical - the desktop
 * resolves under its seat and has no roster to consult.
 *
 * THE FACE NEVER SPELLS A ROOT ITSELF. Both halves come from a `RootEntry` the
 * server handed over: `kind` here, and `name` as the first component of `path`.
 */

/** The same level with its honesty flag - the phone's browser shows what was
 *  dropped instead of rendering a trimmed list as complete. */
export const listDirWindow = (path: string, project = "", root = "") =>
  call<DirWindow>("list_dir_window", {
    path,
    ...(project ? { project } : {}),
    ...(root ? { root } : {}),
  });

export const readFileText = (path: string, project = "", root = "") =>
  call<FileText>("read_file_text", {
    path,
    ...(project ? { project } : {}),
    ...(root ? { root } : {}),
  });

/**
 * EVERY PLACE THIS FACE MAY STAND, as the server holds them (FPLAN-0443).
 *
 * PHONE-ONLY. There is no Rust command behind this name and there should not
 * be one: the desktop browses the project it is seated in, from a machine with
 * a file manager on it. `transport.ts` refuses it by name for exactly that
 * reason - see `NOT_ON_THIS_FACE`.
 *
 * ASKED, NEVER ASSUMED. The roster is a read like any other: it can refuse, it
 * can be empty, and both are the server's answer to show rather than a reason
 * for the face to fall back on a list of its own.
 */
export const listRoots = () => call<RootEntry[]>("list_roots", {});

/**
 * Text -> the paths inside it that actually exist, for drop and paste.
 * `base` is nullable because a terminal that has not attached anywhere yet has
 * no cwd, and the backend already treats that as "resolve absolutely".
 */
export const resolvePaths = (base: string | null, candidates: string[]) =>
  call<(string | null)[]>("resolve_paths", { base, candidates });

/* ----------------------------------------------------------------- git -- */

/**
 * One branch's working-tree count, keyed by the branch's own directory.
 *
 * `grain` NAMES THE SCOPE and defaults to the one every existing caller means:
 * empty is the branch's own subtree, which is what the card, the badge sweep
 * and the files screen have always asked for. Passing `repo` asks the wider
 * question - every changed file in the repository this branch lives in - which
 * is the git app's question and nobody else's.
 *
 * THE KEY IS LEFT OFF THE PAYLOAD ENTIRELY when it is empty, exactly as
 * `project` is, so the object handed to `invoke` on the desktop is byte-
 * identical to what it was before this parameter existed. A default that
 * changed the request would be a rewrite of three callers dressed as an
 * addition.
 */
export const gitChanges = (path: string, project = "", grain = "") =>
  call<GitChanges>("git_changes", {
    path,
    ...(project ? { project } : {}),
    ...(grain ? { grain } : {}),
  });

/* ------------------------------------------------------------- git app -- */
/* PHONE-ONLY (DPLAN-0303). Four reads the desktop has no Rust command behind,
   because the desktop answers all four with a real terminal a keystroke away.
   A pocket cannot, so each one is a named payload over the wire.

   THEY ARE NOT WIDER VERSIONS OF THE VERBS ABOVE. `gitChanges` is the badge's
   count in the desktop's exact semantics and stays that way; these carry the
   whole envelope - git's own status codes, untracked names, byte sizes, the
   grain a thing was measured at. Two questions, never one verb answering both
   and leaving the caller to work out which it got. */

/** Every changed path with git's own code beside it - the changes screen. */
export const gitChangeRows = (branch: string, project = "", grain = "") =>
  call<GitChangeRows>("git_change_rows", { branch, project, grain });

/**
 * PHONE-ONLY. The change COUNT, with no list behind it (DPLAN-0305).
 *
 * A third name on the same route, for the same reason `notifications_read` and
 * `notifications_feed` are two names on `/v1/feed`: the shape a caller needs is
 * part of what it is asking for. A badge wants a number. Handing it an
 * envelope and letting it call `.length` costs an array on every tick of a
 * poller that runs for the life of the app.
 *
 * THE DESKTOP COUNTS THROUGH `gitChanges`, whose Rust command already answers
 * exactly that - so this name is refused there rather than bound to the nearest
 * plausible command.
 */
export const gitChangeCount = (branch: string, project = "", grain = "") =>
  call<GitChangeCount>("git_change_count", { branch, project, grain });

/**
 * ONE file's patch, as unified diff text a parser can consume.
 *
 * `ref` reads that file out of a COMMIT instead of the working tree, and the
 * server refuses the combinations that cannot mean anything (a commit has no
 * staging area, and a commit is repo-wide by construction) rather than quietly
 * answering something else. Nothing is pre-refused here: this face asks, and
 * shows the server's sentence when the answer is no.
 */
export const gitFileDiff = (args: {
  branch: string;
  path: string;
  project?: string;
  grain?: string;
  ref?: string;
}) =>
  call<GitFileDiff>("git_file_diff", {
    branch: args.branch,
    path: args.path,
    project: args.project ?? "",
    grain: args.grain ?? "",
    ref: args.ref ?? "",
  });

/** The repository's recent commits. The branch names WHICH repository. */
export const gitLog = (branch: string, project = "", limit = 20) =>
  call<GitLog>("git_log", { branch, project, limit });

/** One commit's facts and per-file stats. Its patch rides `gitFileDiff`. */
export const gitCommit = (branch: string, ref: string, project = "") =>
  call<GitCommit>("git_commit", { branch, ref, project });

/**
 * The repository's remote - the addresses a link-card leaves for.
 *
 * NO NETWORK BEHIND IT. The server reads the repository's own configuration, so
 * this answers whether the forge is up or down, reachable or not: it says where
 * the repository points, which is all a link needs to know. Anything about what
 * is ON the forge - open pull requests, issue counts - is a different lane
 * needing credentials, and this one deliberately is not it.
 */
export const gitRemote = (branch: string, project = "") =>
  call<GitRemote>("git_remote", { branch, project });

/** The whole seated project's count - a different question, deliberately. */
export const gitProjectChanges = () => call<GitChanges>("git_project_changes");

export const gitDiffText = (path: string, project = "") =>
  call<FileText>("git_diff_text", project ? { path, project } : { path });

/* --------------------------------------------------------------- rooms -- */

/**
 * End a room. The project is REQUIRED, not inferred: a room name carries its
 * project scope, so resolving it against the seat would name a different room
 * and kill the wrong session. Learned the hard way - see key learning #22.
 */
export const roomKill = (branchName: string, project: string | null) =>
  call<void>("room_kill", { branchName, project });

/* ------------------------------------------------------------ terminals -- */
/* Desktop-only. The phone reaches the same tmux room over a socket instead
   (`openRoomSocket` below) rather than binding any of these. */

export const ptyCreate = (args: Record<string, unknown>) =>
  call<SpawnResult>("pty_create", args);

export const ptyWrite = (id: string, data: string) => call<void>("pty_write", { id, data });

export const ptyResize = (id: string, cols: number, rows: number) =>
  call<void>("pty_resize", { id, cols, rows });

export const ptyKill = (id: string) => call<void>("pty_kill", { id });

export const monitorCreate = (args: Record<string, unknown>) =>
  call<string>("monitor_create", args);

/* ---------------------------------------------------------------- bell -- */

export const notificationsRead = () => call<NotificationEvent[]>("notifications_read");

/**
 * PHONE-ONLY. One cursor-keyed window of the feed, envelope and all.
 *
 * The desktop reads the feed file off its own disk and keeps no cursor, so
 * there is no Rust command behind this name and calling it from the desktop
 * build would rightly fail. It lives here rather than in `phone/` because this
 * file is the ONE vocabulary - a verb hidden beside its caller is how a second
 * seam starts.
 *
 * Pass `since: null` for first contact: the server answers with the most recent
 * window rather than the whole file.
 */
export const notificationsFeed = (since: string | null, limit: number) =>
  call<FeedWindow>("notifications_feed", { since, limit });

/* ---------------------------------------------------------------- verbs -- */
/* PHONE-ONLY, OPERATE scope (FPLAN-0413 phase 6). The desktop already does all
   three of these locally - it opens ptys, it kills rooms, the operator's own
   compositor locks the screen - so there is no Rust command behind these names.
   They exist because doing them from a pocket goes over a wire, and a wire
   needs a named payload.

   TERMINAL-AGNOSTIC, still: `wake` names a branch and a message. It does NOT
   name a model, because the branch's own config decides that (Patrick's ruling,
   2026-08-14) - there is not one vendor word in this contract. */

/** Wake an agent in its branch. Never admin: a woken agent is a worker. */
export const verbWake = (branch: string, project: string, message: string) =>
  call<VerbResult>("verb_wake", { branch, project, message });

/**
 * End a room. DESTRUCTIVE, and the project is required rather than inferred -
 * the same rule `roomKill` carries on the desktop and for the same reason.
 */
export const verbKill = (branch: string, project: string) =>
  call<VerbResult>("verb_kill", { branch, project });

/** Lock the machine's screen, through @skills' own lock skill. */
export const verbLock = () => call<VerbResult>("verb_lock");

/* -------------------------------------------------------------- backup -- */
/* PHONE-ONLY (DPLAN-0411). @backup's verbs through @api's door; the shapes are
   pinned in devpulse/docs.local/backup_door_contract.md. The project is
   REQUIRED and travels verbatim, like every verb: the server resolves it, the
   face never composes a path. */

/** Start a lane. Answers at once with the job, state running (202). */
export const backupRun = (project: string, lane: BackupLane) =>
  call<BackupJob>("backup_run", { project, lane });

/** One job's state. A server restart forgets it: 404 job_unknown. */
export const backupJob = (id: string) => call<BackupJob>("backup_job", { id });

/** The project's store, read from disk. `sizes` walks the store: seconds, on demand. */
export const backupStatus = (project: string, sizes = false) =>
  call<BackupStatus>("backup_status", { project, sizes });

/**
 * Stop a run (DPLAN-0412). `lane` is the verb that was pressed: `all` stops the
 * whole cycle. Answers with @backup's own line; nothing running is 404
 * not_running, which means the run ended between two reads.
 */
export const backupCancel = (project: string, lane: BackupLane) =>
  call<BackupCancel>("backup_cancel", { project, lane });

/* ------------------------------------------------------------ terminal -- */
/* PHONE-ONLY (FPLAN-0414 seam 3, as amended). Not a lesser terminal and not a
   picture of one: the phone attaches a REAL client to the same tmux room the
   desktop attaches to, over a socket instead of a pty in a pane.

   There is no `roomPane`/`roomType`/`roomKey` here any more. Those were the
   repaint design - poll a screen, send a named key - and Amendment 1 cut it in
   favour of the room itself. The 14-key allowlist went with them and is not a
   loss: an allowlist was the whole safety of `send-keys`, which INTERPRETS what
   it is handed. A stream has no such path - the key bar writes the same control
   bytes a keyboard writes, and nothing anywhere interprets them.

   A socket is not an `invoke`, so this door is not a `call` - but it is still
   bound the same way: both transports export it, the vite alias picks one, and
   the desktop's refuses by construction because `pty.rs` already does it better
   without a network hop. Imported from `./transport` like every other door, so
   the http binding never enters the desktop's import graph. */
export { openRoomSocket, uploadImage } from "./transport";

/* ------------------------------------------------------------ settings -- */

export const agentSettingsRead = (agent: string) =>
  call<AgentSettings>("agent_settings_read", { agent });

export const agentSettingsWrite = (agent: string, patch: AgentSettingsPatch) =>
  call<AgentSettings>("agent_settings_write", { agent, patch });

export const baudSettingsRead = () => call<BaudSettings>("baud_settings_read");

export const baudSettingsWrite = (patch: unknown) => call<BaudSettings>("baud_settings_write", { patch });

export const hooksSoundGet = () => call<boolean>("hooks_sound_get");

export const hooksSoundSet = (active: boolean) => call<boolean>("hooks_sound_set", { active });

export const memoryConfigRead = () => call<MemoryConfig>("memory_config_read");

export const memoryConfigWrite = (patch: unknown) => call<MemoryConfig>("memory_config_write", { patch });

/* THE ROLLOVER COUNTS GO THROUGH @memory's OWN VERBS, never a file write
   (round A ruling). Bounds are 1-100 and the refusals are sentences @memory
   wrote; both live in one place that way, and BAUD shows what it is told
   rather than re-deciding it. `memoryConfigWrite` above keeps the direct lane
   for entry CHARACTER caps only - those have no verb behind them yet.

   All three answer with the whole config re-read AFTER the verb ran, which is
   the only honest proof a write landed: @memory's refusals exit 0, so a caller
   that trusted the exit status would report a refused write as a success. The
   phone meets the same hazard in a different costume - @api passes the refusal
   through as HTTP 200 with {ok: false} - and its transport throws on that.

   THE READ-BACK IS PART OF THE VERB, not part of the caller. The desktop's
   Rust command re-reads the file itself; @api's write answers with a receipt
   ({ok, detail}) and no config at all. So the read happens HERE, once, and
   both faces hand their caller the same freshly-read MemoryConfig. It costs
   the desktop one extra local read and buys one behaviour instead of two.

   Each write is awaited BEFORE the read - a read fired alongside the write
   would be racing it and could answer with the old number, which is exactly
   the false "saved" this whole lane exists to prevent. */

/** One branch's keep-count for one entry type. */
export const memoryConfigSet = async (branch: string, entryType: string, count: number) => {
  await call<unknown>("memory_config_set", { branch, entryType, count });
  return memoryConfigRead();
};

/** A default keep-count. Does NOT reach any branch until a push. */
export const memoryConfigSetDefault = async (entryType: string, count: number) => {
  await call<unknown>("memory_config_set_default", { entryType, count });
  return memoryConfigRead();
};

/** Reset EVERY branch to the defaults. Fleet-wide, and confirmed twice. */
export const memoryConfigPush = async () => {
  await call<unknown>("memory_config_push");
  return memoryConfigRead();
};

/* -------------------------------------------------------------- camera -- */
/** Desktop-only: the machine's own screen, through the compositor's portal. */
export const screenshotCapture = () => call<string>("screenshot_capture");
