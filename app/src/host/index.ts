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
  BaudSettings,
  BranchStatus,
  DirEntryInfo,
  FeedWindow,
  FileText,
  FleetSnapshot,
  GitChanges,
  MemoryConfig,
  NotificationEvent,
  ProjectListing,
  SpawnResult,
  VerbResult,
} from "../types";
import { call } from "./transport";

export { HostChannel, openExternal } from "./transport";

/* ---------------------------------------------------------------- fleet -- */

/** The seated project's cards plus the scan every card was read from. */
export const fleetSnapshot = () => call<FleetSnapshot>("fleet_snapshot");

/** Every project's citizens, for the roster tabs - one sweep, not one per card. */
export const agentRoster = () => call<BranchStatus[]>("agent_roster");

/* -------------------------------------------------------------- projects -- */

export const listProjects = () => call<ProjectListing[]>("list_projects");

export const projectSwitch = (name: string) => call<void>("project_switch", { name });

/* ------------------------------------------------------------ read lane -- */

/** Fenced: the backend resolves under the seated project - callers pass names. */
export const listDir = (path: string) => call<DirEntryInfo[]>("list_dir", { path });

export const readFileText = (path: string) => call<FileText>("read_file_text", { path });

/**
 * Text -> the paths inside it that actually exist, for drop and paste.
 * `base` is nullable because a terminal that has not attached anywhere yet has
 * no cwd, and the backend already treats that as "resolve absolutely".
 */
export const resolvePaths = (base: string | null, candidates: string[]) =>
  call<(string | null)[]>("resolve_paths", { base, candidates });

/* ----------------------------------------------------------------- git -- */

/** One branch's working-tree count, keyed by the branch's own directory. */
export const gitChanges = (path: string) => call<GitChanges>("git_changes", { path });

/** The whole seated project's count - a different question, deliberately. */
export const gitProjectChanges = () => call<GitChanges>("git_project_changes");

export const gitDiffText = (path: string) => call<FileText>("git_diff_text", { path });

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

/* -------------------------------------------------------------- camera -- */
/** Desktop-only: the machine's own screen, through the compositor's portal. */
export const screenshotCapture = () => call<string>("screenshot_capture");
