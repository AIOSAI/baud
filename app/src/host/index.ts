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
  FileText,
  FleetSnapshot,
  GitChanges,
  MemoryConfig,
  NotificationEvent,
  ProjectListing,
  SpawnResult,
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
/* Desktop-only. The phone deep-links into a native terminal attached to the
   same tmux room instead of binding any of these. */

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
