# The desktop window

The desktop window: BAUD's Tauri app, for the machine BAUD runs on.

## Running it

```
cd app && npm run tauri dev
```

That is where the current app lives. `npm run tauri dev` starts Vite on port
1420 (pinned, `strictPort`) and runs a debug build of the Rust binary in a Tauri
window: frontend edits hot-reload, Rust edits rebuild and restart the app.

BAUD resolves its **anchor** without hardcoding anything: `AIPASS_ROOT` when it
is set (and it must contain `src/aipass`, or BAUD reports that instead of
guessing), otherwise the first ancestor of the working directory that contains
`src/aipass`. From there the header's project switcher can seat the view in any
other project BAUD discovered.

**The release binary.** `npm run tauri build` produces
`app/src-tauri/target/release/baud` (running `tsc && vite build` first);
`bundle.active` is `false` in `tauri.conf.json`, so a build produces the
binary, not installers. The desktop launcher
(`~/.local/share/applications/baud.desktop`) execs this binary directly, so a
rebuild IS the deploy; its `Path=` seats the process inside the AIPass tree,
which is how the release app's ancestor-walk finds its anchor.

## The pages

Each part of the window has its own page under `docs/desktop/`.

| Page | What it covers |
| --- | --- |
| [window and cards](desktop/window-and-cards.md) | the header, footer, zoom and project switcher; the cards and their doors; what a launch types; the opened passport |
| [rooms](desktop/rooms.md) | rooms and the seat model, the terminal, the workbench tabs, the bell |
| [settings](desktop/settings.md) | the card gear, the header gear, the memory dials |

## The desktop face — `src/desktop/` (19 files)

Paths in this section are under `app/`.

One window, panes inside it. `main.tsx` mounts, and `App.tsx` (929 lines) is the
shell that owns the rest. The other 17 files are the panes themselves — they are
desktop-only, and since 2026-08-18 the directory says so.

| File | One line |
|---|---|
| `Terminal.tsx` | The operator's real terminal — xterm over a Rust pty. The centrepiece. |
| `FleetStrip.tsx` | The fleet, as a strip of cards. |
| `BranchChip.tsx` | One agent's card: status, counts, doors. |
| `FileTree.tsx` · `FileView.tsx` · `DiffView.tsx` | Browse, read, diff. |
| `PassportView.tsx` | An agent's identity and memory, read. |
| `MonitorPane.tsx` · `InquiryPane.tsx` | Log monitor; the ask-an-agent pane. |
| `Bell.tsx` | The notification shade and its unread marker. |
| `SettingsDialog.tsx` · `AgentSettings.tsx` · `InterfaceSettings.tsx` · `MemorySettings.tsx` | Four settings surfaces: one per owner of the file being edited. |
| `ProjectSwitch.tsx` · `Camera.tsx` · `Zoom.tsx` | Seat picker; capture; scale. |

## The camera

One click opens the compositor's own screenshot picker — region,
window or full screen — through the XDG Desktop Portal's interactive mode. On
Wayland no application may read screen pixels directly, and the portal is the
one sanctioned door; BAUD ships its own portal client (`ashpd`, pure Rust over
D-Bus) rather than shelling out to a screenshot binary. The capture is copied to
`~/Pictures/BAUD/baud-<stamp>.png` and its path is typed into the chat box,
unsubmitted — claude reads images by path, so the path is the delivery, and
Enter stays the operator's. The button goes quiet while a request is out and
carries the failure (including a cancelled picker) in its tooltip. On non-Linux
targets the command returns an honest error.

## The command surface

`invoke_handler` in `app/src-tauri/src/lib.rs` is the canonical inventory —
30 commands, and nothing reaches the backend that is not on this list:

```
fleet_snapshot  agent_roster  list_projects  project_switch
list_dir  read_file_text  resolve_paths
git_changes  git_project_changes  git_diff_text
room_kill  screenshot_capture
pty_create  pty_write  pty_resize  pty_kill  monitor_create
notifications_read
agent_settings_read  agent_settings_write
baud_settings_read  baud_settings_write
hooks_sound_get  hooks_sound_set
memory_config_read  memory_config_write
memory_config_set  memory_config_set_default  memory_config_push
host_api_call
```

`host_api_call` is the relay to @api's host API, the server the phone uses
(`host_relay.rs`). The window reaches every lane the phone has through it: the
git, backup, machine and roots lanes, new projects, and any read that names a
project. The page hands the relay the phone's own wire request (`GET` or `POST`,
a path under `/v1/`, a query, a body) and gets the status and the raw body back.
`transport.http.ts` then parses it exactly as it parses the phone's `fetch`, so
a refusal is the same `HostError` on both faces. Anything outside the fence is an
error that names the rule.

The relay reads the bind from @api's config store
(`~/.secrets/aipass/host_api/config.json`, `host` and `port`; `127.0.0.1:8787`
when absent) and the token from the receipt `~/.secrets/aipass/host_api/baud-desktop.token`.
When that receipt is missing, the relay runs
`drone @api host-api issue-token baud-desktop --scope operate` once, in the
operator's login shell, and reads the new receipt. The token stays in the Rust
process; the page never holds it, and the CSP and the capability grant are
unchanged. A 401 is never re-minted: it comes back with the receipt's path and
the cure (`drone @api host-api revoke-token <id>`, then remove the receipt).

`transport.ts` picks the door per call with `routeOf` (`host/route.ts`), by the
call's shape rather than its name. The seat, the pty, the rooms and the caps
writer always take IPC. Any other Rust command takes IPC only when the call is
desktop-shaped, with no `project`, no `root`, and a path that is absent or
absolute. Everything else goes over the relay. The Rust readers canonicalize a
path against the process and take no project, so a phone screen's
`<branch>/<file>` plus `project` would miss over IPC. Only `openRoomSocket` and
`uploadImage` stay refused on the desktop, by nature: rooms ride the pty, and
the desktop's files are already on this machine.

The registry lives in `lib.rs` while the command functions live in lanes beside
it, deliberately: one list of what a face may invoke is worth more than tidiness
about which file the list sits in. When this list and `generate_handler!`
disagree, `generate_handler!` is right.

Everything BAUD writes, in full: the two settings files, @memory's config,
the hooks mute flag, the screenshot copy in `~/Pictures/BAUD/`, and bytes into
a PTY. There is no write path to any file the reading room can show you.

The capability grant (`app/src-tauri/capabilities/default.json`) is
`core:default`, the webview zoom setter, and the opener's URL-only permissions —
no shell plugin, no filesystem plugin, no asset protocol. A navigation fence
plugin refuses any navigation off the app's own origin, so no stray link or
`window.open` can turn the fleet view into a `file://` directory listing.

## Layout

```
projects/baud/
├── app/                        the desktop application
│   ├── src/                    React + TypeScript frontend
│   │   ├── desktop/            the desktop face — App.tsx (window shell, tabs, launch,
│   │   │                       startup agent), main.tsx, and the 17 components:
│   │   │                       cards, terminal, panes, panels, header tools
│   │   ├── host/               the transport seam — every host call, named once
│   │   │                       transport.ts = tauri IPC or the relay, picked by route.ts ·
│   │   │                       transport.http.ts = /v1 over fetch, and the one parser
│   │   ├── phone/              the wheel face — main.tsx, PhoneApp.tsx (the shell) and 15 screens:
│   │   │                       token door, fleet wheel, expanded agent card, passport sheet, certificate,
│   │   │                       files, roots, memory, machine vitals, agent monitor, reader, feed,
│   │   │                       verb chips, attached terminal, settings
│   │   │   ├── git/            the repository sub-app: changes, one revision, the log, diffs, a file row
│   │   │   └── lib/            the no-JSX logic: verbs, rooms, feed, push, gitStatus, copyPath, whileVisible,
│   │   │                       machine — the monitor row's lane and its card faces,
│   │   │                       and pollers — all four polling lanes, lifted out of the shell
│   │   ├── deliver.ts           the ONE quoting rule - a path, quoted if needed, wrapped in spaces, never submitted
│   │   ├── **/*.test.ts        vitest pins beside the module they test - pure functions only (npm test)
│   │   ├── tokens/             the palette as data, and the CSS generated from it
│   │   ├── types.ts            hand-kept mirrors of the Rust structs
│   │   ├── intent.ts           operator decisions that outlive a remount
│   │   ├── age.ts              relative-age formatting
│   │   └── theme.css           the layout, written entirely in var(--baud-*)
│   ├── src-tauri/src/
│   │   ├── lib.rs              the root: shared types, run(), the command registry — and the tests
│   │   ├── fleet.rs            one pass over the branch directories, one snapshot out
│   │   ├── projects.rs         the census and the seat
│   │   ├── reads.rs            directories, file text, git changes and diffs, all behind one fence
│   │   ├── rooms.rs            tmux sessions: named, scanned, killed, typed into
│   │   ├── sessions.rs         who is actually awake — /proc, transcripts, subagents
│   │   ├── cli.rs              baud --snapshot and the rest of the headless surface
│   │   ├── pty.rs              terminals and monitor panes
│   │   ├── notifications.rs    the bell's feed reader
│   │   ├── settings.rs         the two config writers and the hooks flag
│   │   ├── memory.rs           @memory's dials, read and surgically written
│   │   ├── screenshot.rs       the XDG portal client
│   │   ├── host_relay.rs       the relay to the host API: bind, token receipt, /v1 fence
│   │   ├── main.rs             thin binary entry — the desktop app, gui feature on
│   │   └── bin/baud_cli.rs     baud-cli — the six headless verbs, no window, no GTK
│   ├── src-tauri/capabilities/ the permission grant
│   ├── phone.html              the phone face's entry document
│   ├── public/                 the PWA manifest and its icons
│   ├── vite.config.phone.ts    the phone build — one alias, and that alias is the whole port
│   ├── dist/                   vite output (build artifact, not tracked)
│   ├── dist-phone/             phone bundle (build artifact, not tracked)
│   └── README.md               a pointer at the root README and MAP.md, and nothing else
├── src/baud/baud/              @baud — the project's resident agent
├── tests/                      no tests — a README naming where they actually live
├── .github/
│   ├── workflows/ci.yml        the audit lane, both builds included, run by a robot
│   ├── workflows/release.yml   tag push -> tested build -> published release
│   ├── actions/                the Ubuntu build deps, shared by both workflows
│   ├── ISSUE_TEMPLATE/         bug report and feature request templates
│   ├── PULL_REQUEST_TEMPLATE.md what changed, the six checks, the docs that moved
│   └── dependabot.yml          weekly grouped updates: npm, cargo, actions
├── CHANGELOG.md                what each release changed, and what waits in Unreleased
├── SECURITY.md                 the security model, and how to report a problem
├── MAP.md                      the map — where every piece of this repo lives
├── BAUD_REGISTRY.json          the project seal
├── LICENSE                     MIT, mirroring the AIPass repo's own
├── CLAUDE.md, AGENTS.md        agent startup instructions
├── .claude/, .aipass/          agent settings, prompt tiers, hooks
└── README.md                   the stranger's page; the operator's docs live in docs/
```

**`src/` is not old app code.** It is the AIPass agent scaffold for @baud, the
project's resident citizen: `apps/baud.py` is the standard auto-discovery CLI
entry point reached as `drone @baud`; `apps/modules/` and `apps/handlers/`
hold no modules. `BAUD_REGISTRY.json` names `src/baud/baud` as its one branch, which
makes `src/baud` this project's fleet directory — seat BAUD in the BAUD project
and you get exactly one card.

**`tests/` holds no tests.** Its README names where the tests actually are. The Rust tests live in
`app/src-tauri/src/`, in `#[cfg(test)]` modules beside the code they test. The
frontend's tests are vitest files beside the modules they pin (`*.test.ts` under
`app/src/`), pure functions only, run by `npm test` alongside `tsc --noEmit` and
the two bundle builds. There is no Python surface. A signpost that points
somewhere beats a directory that only looks like a suite.

**`CLAUDE.md` and `AGENTS.md`** carry the same startup protocol for the agent
working in this directory (read `.trinity/`, use drone, keep memories current);
they are agent instructions, not documentation of the app.
