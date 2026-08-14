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
 * DESKTOP-ONLY BY DESIGN, and worth being explicit about: the phone face never
 * binds this. Its terminal is a deep link into Termux running `mosh` + `tmux
 * attach` against the same room (DPLAN-0300 R-TERM), so the pocket attaches to
 * a real terminal instead of streaming bytes into a webview emulator.
 */
export { Channel as HostChannel };
