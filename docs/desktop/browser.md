# The browser

This page covers BAUD's own Chrome: the profile it runs on, the room and port it
runs in, the four states the BROWSER tab reads, and the native-hosts link. The
host side is `app/src-tauri/src/browser.rs`; the screen is
`app/src/phone/BrowserScreen.tsx`. Linux only: elsewhere the three commands
answer with a refusal.

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
  --remote-debugging-port=9333 --no-first-run --no-default-browser-check \
  ; set-option -t =baud-chrome: remain-on-exit on
```

`<chrome>` is `google-chrome` from `PATH`, else `google-chrome-stable`.
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
| `running` | yes | answers | the open pages from `/json/list`, pages only, as id, title, url |
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

## Not yet there

- The picture: the tab lists pages but shows none of them, and a page row opens
  nothing.
- The phone: the phone's card opens the screen, and the host refuses with
  `not_on_the_phone`; the phone's view of BAUD's Chrome waits on @api's socket
  lane.
