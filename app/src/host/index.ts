/** The host surface: every host capability, named and typed once; verbs never name one terminal's flags. */

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
  MachineProcesses,
  MachineVitals,
  MemoryConfig,
  NewProjectResult,
  NotificationEvent,
  ProjectListing,
  RootEntry,
  SpawnResult,
  VerbResult,
} from "../types";
import { call } from "./transport";

export { HostChannel, openExternal } from "./transport";

/** The seated project's cards; `project` is omitted when absent so the desktop's Tauri payload is unchanged. */
export const fleetSnapshot = (project?: string) =>
  project ? call<FleetSnapshot>("fleet_snapshot", { project }) : call<FleetSnapshot>("fleet_snapshot");

export const agentRoster = () => call<BranchStatus[]>("agent_roster");

/** No arguments ever: the route refuses any query parameter, a cache-buster included. */
export const machineVitals = () => call<MachineVitals>("machine_vitals");

/** Never polled: the skill sleeps ~0.5 s per sample to measure cpu. */
export const machineProcesses = (limit?: number) =>
  limit === undefined
    ? call<MachineProcesses>("machine_processes")
    : call<MachineProcesses>("machine_processes", { limit });

export const lockState = () => call<LockState>("lock_state");

export const listProjects = () => call<ProjectListing[]>("list_projects");

export const projectSwitch = (name: string) => call<void>("project_switch", { name });

/** Fenced: the backend resolves under the seated project - callers pass names. */
export const listDir = (path: string) => call<DirEntryInfo[]>("list_dir", { path });

/* Empty `project`/`root` stay off the payload so the desktop's `invoke` is unchanged; absent `root` means branch. */

export const listDirWindow = (path: string, project = "", root = "", offset = 0) =>
  call<DirWindow>("list_dir_window", {
    path,
    ...(project ? { project } : {}),
    ...(root ? { root } : {}),
    ...(offset > 0 ? { offset } : {}),
  });

export const readFileText = (path: string, project = "", root = "") =>
  call<FileText>("read_file_text", {
    path,
    ...(project ? { project } : {}),
    ...(root ? { root } : {}),
  });

export const listRoots = () => call<RootEntry[]>("list_roots", {});

/** `base` is null when a terminal has no cwd yet; the backend then resolves absolutely. */
export const resolvePaths = (base: string | null, candidates: string[]) =>
  call<(string | null)[]>("resolve_paths", { base, candidates });

/** Empty `grain` is the branch subtree; `repo` is the git app's repo-wide question. */
export const gitChanges = (path: string, project = "", grain = "") =>
  call<GitChanges>("git_changes", {
    path,
    ...(project ? { project } : {}),
    ...(grain ? { grain } : {}),
  });

/* Phone-only git app reads, whole envelopes; not wider `gitChanges`, which keeps the badge's semantics. */

export const gitChangeRows = (branch: string, project = "", grain = "") =>
  call<GitChangeRows>("git_change_rows", { branch, project, grain });

/** The count with no list behind it, so a badge poller allocates no array. */
export const gitChangeCount = (branch: string, project = "", grain = "") =>
  call<GitChangeCount>("git_change_count", { branch, project, grain });

/** `ref` reads from a commit; the server refuses meaningless combinations, so nothing is pre-refused here. */
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

export const gitLog = (branch: string, project = "", limit = 20) =>
  call<GitLog>("git_log", { branch, project, limit });

export const gitCommit = (branch: string, ref: string, project = "") =>
  call<GitCommit>("git_commit", { branch, ref, project });

/** The repository's remote. Reads local git config only: no network, so it says nothing about the forge being up. */
export const gitRemote = (branch: string, project = "") =>
  call<GitRemote>("git_remote", { branch, project });

export const gitProjectChanges = () => call<GitChanges>("git_project_changes");

export const gitDiffText = (path: string, project = "") =>
  call<FileText>("git_diff_text", project ? { path, project } : { path });

/** The project is required: a room name carries its project scope, so inferring it kills the wrong session. */
export const roomKill = (branchName: string, project: string | null) =>
  call<void>("room_kill", { branchName, project });

export const ptyCreate = (args: Record<string, unknown>) =>
  call<SpawnResult>("pty_create", args);

export const ptyWrite = (id: string, data: string) => call<void>("pty_write", { id, data });

export const ptyResize = (id: string, cols: number, rows: number) =>
  call<void>("pty_resize", { id, cols, rows });

export const ptyKill = (id: string) => call<void>("pty_kill", { id });

export const monitorCreate = (args: Record<string, unknown>) =>
  call<string>("monitor_create", args);

export const notificationsRead = () => call<NotificationEvent[]>("notifications_read");

/** Phone-only. `since: null` asks for the most recent window, not the whole file. */
export const notificationsFeed = (since: string | null, limit: number) =>
  call<FeedWindow>("notifications_feed", { since, limit });

/* Phone-only, operate scope. `wake` names no model: the branch's own config decides that. */

/** Never admin: a woken agent is a worker. */
export const verbWake = (branch: string, project: string, message: string) =>
  call<VerbResult>("verb_wake", { branch, project, message });

export const verbKill = (branch: string, project: string) =>
  call<VerbResult>("verb_kill", { branch, project });

export const verbLock = () => call<VerbResult>("verb_lock");

export const verbNewProject = (name: string, template: string) =>
  call<NewProjectResult>("verb_new_project", { name, template });

/* Phone-only; shapes in docs/phone/backup.md. The project travels verbatim: the face never composes a path. */

export const backupRun = (project: string, lane: BackupLane) =>
  call<BackupJob>("backup_run", { project, lane });

/** One job's state. A server restart forgets it: 404 job_unknown. */
export const backupJob = (id: string) => call<BackupJob>("backup_job", { id });

/** `sizes` walks the store: seconds, so only on demand. */
export const backupStatus = (project: string, sizes = false) =>
  call<BackupStatus>("backup_status", { project, sizes });

/** 404 not_running means the run ended between two reads. */
export const backupCancel = (project: string, lane: BackupLane) =>
  call<BackupCancel>("backup_cancel", { project, lane });

/* Not `call`s, but both transports export them and the vite alias picks one, keeping http out of the desktop. */
export { openRoomSocket, uploadImage } from "./transport";

export const agentSettingsRead = (agent: string, project = "") =>
  call<AgentSettings>("agent_settings_read", project ? { agent, project } : { agent });

export const agentSettingsWrite = (agent: string, patch: AgentSettingsPatch, project = "") =>
  call<AgentSettings>("agent_settings_write", project ? { agent, patch, project } : { agent, patch });

export const baudSettingsRead = () => call<BaudSettings>("baud_settings_read");

export const baudSettingsWrite = (patch: unknown) => call<BaudSettings>("baud_settings_write", { patch });

export const hooksSoundGet = () => call<boolean>("hooks_sound_get");

export const hooksSoundSet = (active: boolean) => call<boolean>("hooks_sound_set", { active });

export const memoryConfigRead = () => call<MemoryConfig>("memory_config_read");

export const memoryConfigWrite = (patch: unknown) => call<MemoryConfig>("memory_config_write", { patch });

/* Rollover counts go through @memory's verbs, whose refusals exit 0: each write is awaited, then the config
   re-read here, the only proof it landed. A read fired alongside would race the write. */

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

export const screenshotCapture = () => call<string>("screenshot_capture");
