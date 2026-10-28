# The browser

This page covers BAUD's own Chrome: the profile it runs on, the room and port it
runs in, the four states the BROWSER tab reads, the native-hosts link, and the
live view of the shown page. The host side is `app/src-tauri/src/browser.rs`;
the screen is `app/src/phone/BrowserScreen.tsx`, the live view
`app/src/phone/BrowserView.tsx` with its input mapping in
`app/src/phone/lib/browserInput.ts`. Linux only: elsewhere the commands answer
with a refusal.

← [the desktop window](../desktop.md) · [the apps](apps.md)

## The profile

BAUD's Chrome runs on `<BAUD config dir>/chrome` (on Linux
`~/.config/ai.aipass.baud/chrome`), never on `~/.config/google-chrome`.
Chrome 136 and later refuse remote debugging on the default user-data-dir, so
the profile every subscription and the Claude in Chrome extension are signed
into has to live at another path to be driven. Two doors fill it:

- **launch** on an empty path starts a fresh profile.
- **adopt my Chrome** (`browser_adopt`) copies `~/.config/google-chrome` into
  BAUD's path, then launches. It refuses only while the `baud-chrome` room is
  open or any `chrome` process runs (the copy must be consistent). A profile
  already at BAUD's path is renamed aside to
  `<profile>.before-adopt-<UTC YYYYMMDDTHHMMSSZ>`, never deleted, and the copy
  lands in a fresh directory. The copy skips `SingletonLock`,
  `SingletonSocket`, `SingletonCookie` and every `Cache`, `Code Cache` and
  `GPUCache` directory, never follows a link, and reports the bytes copied,
  the seconds taken and where the previous profile now is.

## The room and the port

Chrome runs in a detached tmux session named `baud-chrome`, started as one
argv with no shell:

```
tmux new-session -d -s baud-chrome -- <chrome> --user-data-dir=<profile> \
  --remote-debugging-port=9333 --headless=new --window-size=1280,800 \
  --no-first-run --no-default-browser-check \
  ; set-option -t =baud-chrome: remain-on-exit on
```

`<chrome>` is `google-chrome` from `PATH`, else `google-chrome-stable`.
Chrome runs headless: no window on the desktop, the BROWSER tab is the only
face it has, and the page keeps painting whatever covers BAUD (the numbers
under the live view say why).
`remain-on-exit` keeps a crashed Chrome's last lines in the pane. The port is
fixed at 9333 and read only on `127.0.0.1`. Launches are serialized; a launch
polls `/json/version` every 200 ms for up to ten seconds. The room is BAUD's
own: closing the tab, switching project or reloading the window leaves Chrome
running, and nothing restarts it unasked.

## The four states

`browser_status` judges from two facts, whether the `baud-chrome` room exists
and whether `http://127.0.0.1:9333/json/version` answers:

| State | Room | Port | What the tab shows |
| --- | --- | --- | --- |
| `running` | yes | answers | the tab row from `/json/list` (pages only), the URL bar and the shown page live |
| `down` | no | silent | `BAUD's Chrome is not running`, `launch`, `adopt my Chrome` |
| `foreign` | no | answers | port 9333 is held by a Chrome BAUD did not launch; launch changes nothing |
| `stale` | yes | silent | the pane's last lines: a Chrome still starting, hung, or exited |

`launch` on `running` or `foreign` returns the status unchanged. On `stale`
with an exited Chrome it closes the room and starts a new one; with a Chrome
still in the pane it returns the status. A launch whose port never answers
returns `stale` with the pane's last lines.

## The native-hosts link

Chrome reads native-messaging manifests from `<user-data-dir>/NativeMessagingHosts`,
and Claude Code installs its manifest only under `~/.config/google-chrome`. A
launch symlinks `~/.config/google-chrome/NativeMessagingHosts` into the profile
when that directory exists and the profile has none, so the extension can reach
Claude Code. Adopt skips that directory on purpose: a link follows a reinstalled
manifest, a copy would freeze it. The tab names the result: `linked` (the symlink
holds Claude Code's manifest), `present` (a real directory holds it) or `absent`.

## The live view

The webview never opens a socket to Chrome. Its CSP allows `connect-src
'self'` only, and Chrome's DevTools server refuses any WebSocket carrying an
`Origin` not named in `--remote-allow-origins`, a flag BAUD never passes. Rust
owns the socket: `tungstenite` (sync, no TLS) over a std `TcpStream` to
`127.0.0.1:9333`, connected to the page's own `webSocketDebuggerUrl` path from
`/json/list`, one thread per view. No `Target.*` domain, no browser socket.

| Verb | Shape |
| --- | --- |
| `browser_view_open(target_id, on_event)` | the view id; the stream arrives on the `Channel<BrowserEvent>` |
| `browser_view_close(view_id)` | ends BAUD's stream; the page stays open in Chrome |
| `browser_input(view_id, event)` | `{kind: "mouse" \| "key", params}`, CDP's own params for `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`; no other method crosses |
| `browser_navigate(view_id, url)` | `Page.navigate` |
| `browser_new_tab()` | `PUT /json/new?about:blank` (Chrome answers it only to PUT), the new page as `{id, title, url}` |

A view opens with `Page.bringToFront` (a background tab paints nothing) and
`Page.startScreencast {format: "jpeg", quality: 60, maxWidth: 1280, maxHeight:
1280, everyNthFrame: 1}`. Each `Page.screencastFrame` is acked at once with
`Page.screencastFrameAck {sessionId}` (unacked, Chrome stops after a few
frames) and forwarded as `frame {data, device_width, device_height,
page_scale, scroll_x, scroll_y}`: the JPEG as base64 and the page's CSS size.
`Page.screencastVisibilityChanged` becomes `visibility {visible}`;
`Inspector.detached`, a crash or a closed socket becomes `closed {reason}` and
ends the thread. Closing the view drops its command queue, and the thread sends
`Page.stopScreencast` and lets go of the socket. Input waits at most 10 ms for
its turn on the socket between reads.

The tab draws the newest frame on a canvas scaled to the tab's width: frames
that arrive while one decodes replace each other, so the picture never falls
behind. Above it, the tab row lists the pages (a click shows that page, `+`
opens one) and the URL bar shows the shown page's url from the five-second
poll; Enter navigates, a bare host gaining `https://`. A view opens when the
tab mounts or a page is picked, and closes when the tab closes or leaves the
front, on a project switch and on `beforeunload`. A closed view shows its
reason and the next poll shows the first page again.

Input reaches the page only through the canvas:

- **Mouse.** Press, release and move go to `Input.dispatchMouseEvent` at
  `x = cx * device_width / shown width` (and the same for `y`), from the drawn
  frame's CSS size, never the image's pixels. A move carries the held button so
  a drag selects. The wheel goes as `mouseWheel`, line deltas at 40 px a line;
  Ctrl+wheel stays BAUD's zoom. The context menu is not BAUD's over the canvas.
- **Keys**, only while the canvas has focus (a press on it focuses it):
  keydown is `keyDown` with the virtual key code, and printable text (Enter as
  `\r`) follows as `char` with `text`, as DevTools' InputModel does; keyup is
  `keyUp`. Modifiers are Alt 1, Ctrl 2, Meta 4, Shift 8. BAUD's zoom keys never
  arrive: the window takes them in the capture phase.

`visibility {visible: false}` replaces the canvas with `Chrome's window is
hidden; frames stop until it is shown`; headless Chrome never sends it, the
line is for a Chrome someone runs headed. Chrome's own UI (the extension's
side panel, popups, native dialogs such as a file picker or a permission
prompt) has no window to show in; the tab shows the page only, and a native
prompt is invisible.

### Measured on this desktop, the reason for headless

On GNOME Wayland, Chrome 156 with no ozone flag runs native Wayland. A
headed window that GNOME opened behind the focused window sent at most the one
frame the screencast starts with, and none while its page was scrolled;
minimised, it sent none and reported no visibility change, so the tab kept the
last picture. Under XWayland (`--ozone-platform=x11`, with
`--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`) the
same placement gave 1 frame in 3 s of scrolling; raised on top it gave 28 a
second, and minimised it reported `visible: false`. Frames come only while a
headed Chrome's window is drawn on screen, and BAUD covers it. Headless at
`--window-size=1280,800` gave 57 frames a second scrolling, 1280x713 CSS px,
about 17 KB a frame. The image is capped at 1280 px wide, below a HiDPI
screen's device pixels.

## Not yet there

- The phone: the phone's card opens the screen, and the host refuses every
  browser verb with `not_on_the_phone`; the phone's view of BAUD's Chrome
  waits on @api's socket lane.
- Touch, the clipboard, closing tabs, and Chrome's own UI (native prompts
  cannot be seen or answered).
