/** Which door a desktop call takes: the window's own Rust command, or the relay to the host-api. */

/** The Rust commands the window registers (`lib.rs`'s `generate_handler!`), the relay itself excepted. */
export const IPC_COMMANDS: ReadonlySet<string> = new Set([
  "fleet_snapshot",
  "agent_roster",
  "list_projects",
  "project_switch",
  "list_dir",
  "read_file_text",
  "resolve_paths",
  "git_changes",
  "git_project_changes",
  "git_diff_text",
  "room_kill",
  "screenshot_capture",
  "pty_create",
  "pty_write",
  "pty_resize",
  "pty_kill",
  "monitor_create",
  "notifications_read",
  "agent_settings_read",
  "agent_settings_write",
  "baud_settings_read",
  "baud_settings_write",
  "hooks_sound_get",
  "hooks_sound_set",
  "memory_config_read",
  "memory_config_write",
  "memory_config_set",
  "memory_config_set_default",
  "memory_config_push",
]);

/** Commands with no `/v1` route: the seat, the pty, the rooms, the caps. Their `project` is Rust's own argument. */
const IPC_ONLY: ReadonlySet<string> = new Set([
  "project_switch",
  "list_dir",
  "resolve_paths",
  "git_project_changes",
  "room_kill",
  "screenshot_capture",
  "pty_create",
  "pty_write",
  "pty_resize",
  "pty_kill",
  "monitor_create",
  "memory_config_write",
]);

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * By the call's shape, not its name: the Rust readers canonicalize a path against the
 * process cwd and take no project, so a phone screen's `<branch>/<file>` plus `project`
 * sent over IPC would read the wrong file, or none.
 */
export function routeOf(command: string, args?: Record<string, unknown>): "ipc" | "http" {
  if (IPC_ONLY.has(command)) return "ipc";
  if (!IPC_COMMANDS.has(command)) return "http";
  if (args?.project || args?.root) return "http";
  const path = args?.path;
  if (typeof path === "string" && !isAbsolute(path)) return "http";
  return "ipc";
}
