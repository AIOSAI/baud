/** The desktop transport: the only file that imports `invoke`, so a second face is a second binding. */

import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Phone-only verbs, refused by name so they never fail as a broken-looking "command not found". */
const NOT_ON_THIS_FACE: Record<string, string> = {
  git_change_rows: "the desktop reads its own working tree - this is the phone's git app",
  git_file_diff: "the desktop reads its own working tree - this is the phone's git app",
  git_log: "the desktop reads its own working tree - this is the phone's git app",
  git_commit: "the desktop reads its own working tree - this is the phone's git app",
  git_remote: "the desktop opens the forge from a terminal beside the repository - this is the phone's git app",
  git_change_count:
    "the desktop counts through git_changes, which its own Rust command already answers - a second name for one number would be a second answer waiting to disagree",
  list_roots: "the desktop browses the project it is seated in - the roots roster is the phone's fence",
  machine_vitals:
    "the desktop sits on the machine it would be reading - the monitor layer is the phone's glance from across the room",
  machine_processes:
    "the desktop sits on the machine it would be reading - the process list is the phone's glance from across the room",
  lock_state:
    "the desktop is the screen whose lock it would be reading - the lock chip is the phone's answer to 'did I lock it'",
  backup_run: "the desktop runs `drone @backup` in its own terminal - the backup card is the phone's door",
  backup_job: "the desktop runs `drone @backup` in its own terminal - the backup card is the phone's door",
  backup_status: "the desktop runs `drone @backup` in its own terminal - the backup card is the phone's door",
  backup_cancel: "the desktop runs `drone @backup` in its own terminal - the backup card is the phone's door",
  verb_new_project: "the desktop runs `aipass new` in its own terminal - the + new project row is the phone's door",
};

/** A typed host call. The only `invoke` in the application. */
export function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const refusal = NOT_ON_THIS_FACE[command];
  if (refusal) return Promise.reject(new Error(`${command} is not served on this face: ${refusal}`));
  return invoke<T>(command, args);
}

/** Hand a URL to the operator's own browser; behind the seam so no component imports `@tauri-apps`. */
export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

export { Channel as HostChannel };

/** The phone's door, refused here; it exists so both transports expose the same surface. */
export function openRoomSocket(_branch: string, _project: string, _kind = ""): WebSocket {
  throw new Error(
    "room sockets are the phone's door - the desktop attaches through its own pty (pty.rs)",
  );
}

export function uploadImage(_file: File): Promise<string> {
  return Promise.reject(
    new Error("uploads are the phone's door - the desktop's files are already on this machine"),
  );
}
