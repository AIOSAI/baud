/** The desktop transport: the only file that imports `invoke`, so a second face is a second binding. */

import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { routeOf } from "./route";
import { callWith, HostError, type Sender } from "./transport.http";

/** The phone's wire request, carried by the window's Rust relay so the token never enters the page. */
const relaySender: Sender = async (request) => {
  try {
    return await invoke<{ status: number; body: string }>("host_api_call", { request });
  } catch (cause) {
    // The relay's Err is a call that never reached an answer: the fence, the config, the mint, the network.
    throw new HostError(0, "unreachable", String(cause));
  }
};

/** A typed host call. The only `invoke` in the application. */
export function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (routeOf(command, args) === "http") return callWith<T>(relaySender, command, args);
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
