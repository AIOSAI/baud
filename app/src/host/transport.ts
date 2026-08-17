/**
 * The transport - the ONE place that knows how a call reaches the host
 * (FPLAN-0412 phase 2).
 *
 * Today there is exactly one binding: tauri's `invoke`, an IPC hop to the Rust
 * backend in this same process. The phone face will bind the same verbs to
 * `fetch` against @api's host API over the tailnet. That is the whole point of
 * the seam: `invoke` appears in this file and nowhere else in the app, so a
 * second face is a second binding rather than a second copy of the frontend.
 *
 * Nothing here is speculative - there is no web binding yet, no runtime switch,
 * no abstraction over a transport that does not exist. Just a named boundary
 * with one implementation behind it, which is what makes adding the second one
 * a small change instead of a rewrite.
 *
 * OUT OF SCOPE, deliberately: `@tauri-apps/api/webview`. Window zoom (Zoom.tsx)
 * and file-drop onto the window (App.tsx) are desktop WINDOW concerns, not host
 * calls - a phone has no window chrome, pinches natively, and shares through a
 * share sheet. Those imports stay where they are rather than pretending to be
 * portable.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/** A typed host call. The only `invoke` in the application. */
export function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

/**
 * Hand a URL to the operator's own browser. A platform capability rather than
 * a backend command, but it belongs behind the same seam for the same reason:
 * it is one line in a web binding (`window.open`) and it keeps the invariant
 * simple - no component imports `@tauri-apps` at all.
 */
export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

/**
 * A streaming channel from the host - today a tauri Channel, which the PTY
 * verbs use to push output as it arrives.
 *
 * DESKTOP-ONLY BY DESIGN. The phone face never binds this: it reaches the same
 * tmux room over a WebSocket instead (`openRoomSocket` below), which is a
 * different mechanism onto the identical session.
 */
export { Channel as HostChannel };

/**
 * Attach a terminal to a room - the PHONE's door, refused here.
 *
 * The desktop already has one, and it is better: `pty.rs` runs a tmux client in
 * a real pane in this process. Routing the desktop through a socket would put a
 * network hop between a window and a session on its own machine.
 *
 * This exists so the two transports expose the SAME surface. `host/index.ts`
 * imports it from `./transport` like everything else, and the vite alias picks
 * the binding - so the http transport is never in the desktop's import graph at
 * all, rather than merely tree-shaken out of its bundle.
 */
export function openRoomSocket(_branch: string, _project: string, _kind = ""): WebSocket {
  throw new Error(
    "room sockets are the phone's door - the desktop attaches through its own pty (pty.rs)",
  );
}

/**
 * Upload an image - the PHONE's door, refused here for the same reason.
 *
 * The desktop's files are already on the machine the agent runs on: its camera
 * button captures straight to disk and its drop handler receives real paths.
 * There is nothing to upload, so this is a refusal rather than a second route
 * to the same place. Both faces converge one step later, at `deliveryText`.
 */
export function uploadImage(_file: File): Promise<string> {
  return Promise.reject(
    new Error("uploads are the phone's door - the desktop's files are already on this machine"),
  );
}
