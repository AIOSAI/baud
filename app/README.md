# BAUD

BAUD is the AIPass desktop. AIPass agents — *citizens* — live in branch directories under
`<AIPASS_ROOT>/src/aipass/`, and each one leaves traces of itself on disk: a passport that
makes it a citizen, a dashboard file describing its mail and plans, and a dispatch lock that
appears exactly while it is awake and working. BAUD watches those traces and renders the
fleet as one screen, so you can see at a glance who is running, who has unread mail, and who
has gone quiet.

**The fleet view is read-only. The terminal is you.** BAUD itself still runs no commands and
writes no files — it watches, and it steers nothing on its own. What milestone 2 adds is a
real shell in the middle of the window: the operator's hands, at the operator's privileges.
Every byte it runs was typed by a human.

## The screen

```
┌──────────────────────────────────────────────────────────────┐
│  BAUD                        citizens  working  mail  plans  │  header: totals
├──────────────────────────────────────────────────────────────┤
│ [●branch] [ branch ] [ branch ] [ branch ] [ branch ] →       │  fleet strip (scrolls sideways)
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  patrick@aipass:~/Projects/AIPass$ ▊                          │  the terminal — centre stage
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  /home/…/AIPass                     polled 2s ago · every 5s │  footer: root + poll status
└──────────────────────────────────────────────────────────────┘
```

The fleet is a single scrolling row of chips — lamp, name, mail, plans — with each chip's
summary and staleness in its tooltip. It refreshes every 5 seconds, unchanged from milestone 1.
The terminal takes everything left over, which is roughly two thirds of the default window.
A snapshot or IPC failure still surfaces as a FAULT banner under the header; nothing is
swallowed.

## Layout

```
app/
├── index.html                     Vite entry document
├── package.json                   dev / build / preview / tauri scripts
├── vite.config.ts                 dev server pinned to port 1420 (strict)
├── tsconfig.json                  app TS config
├── tsconfig.node.json             TS config for vite.config.ts
├── src/                           React 19 frontend
│   ├── main.tsx                   React root
│   ├── App.tsx                    polling loop, header, strip, stage, footer
│   ├── types.ts                   TS mirrors of the Rust payload structs
│   ├── age.ts                     relative-age helper ("3m ago", stale flag)
│   ├── theme.css                  the whole stylesheet (--baud-* tokens)
│   └── components/
│       ├── FleetStrip.tsx         horizontal fleet band, working-first sort
│       ├── BranchChip.tsx         one branch, compressed to a chip
│       └── Terminal.tsx           xterm.js wired to the PTY commands
└── src-tauri/                     Rust backend
    ├── Cargo.toml                 lib `baud_lib` (staticlib/cdylib/rlib)
    ├── build.rs                   tauri_build::build()
    ├── tauri.conf.json            window, CSP, bundle config
    ├── capabilities/default.json  core defaults only
    └── src/
        ├── main.rs                thin wrapper → baud_lib::run()
        ├── lib.rs                 root resolution, fleet scan, fleet_snapshot
        └── pty.rs                 pty_create / write / resize / kill, teardown
```

## Running

```bash
npm install
npm run tauri dev
```

Linux system dependencies (WebKitGTK, GTK, and the SVG loader) must be present first:

```bash
sudo apt install pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
```

`npm run build` alone type-checks and produces `dist/` without touching the Rust toolchain,
which is useful for frontend-only work.

## Finding the AIPass root

No path is ever hardcoded. At runtime the Rust side resolves the root by:

1. `AIPASS_ROOT`, when set and containing a `src/aipass` directory; otherwise
2. walking up from the current working directory to the first ancestor containing `src/aipass`.

If neither works, `fleet_snapshot` returns a snapshot whose `error` field explains why, and the
UI prints it in a FAULT banner. Failure is reported, never swallowed into an empty strip.

The terminal uses the same resolution — one root, one answer — so the shell always opens where
the fleet lives. If the root cannot be resolved, `pty_create` fails with that same explanation
and the terminal shows it on its curtain instead of opening a shell somewhere arbitrary.

## The terminal

The middle of the window is a real PTY running your login shell.

- **What it is.** `$SHELL` (falling back to `/bin/bash`), started as a login shell with
  `TERM=xterm-256color`, working directory = the resolved AIPass root. It has exactly your
  privileges, because it *is* you — the same thing your terminal emulator gives you. Job
  control, `vim`, `less`, `drone`, and interactive agents all work, because it is a terminal
  device and not a pipe.
- **What it is not.** It is not automation. BAUD types nothing into it and reads nothing out
  of it; there is still no code path in this app that decides on its own to run a command.
  The fleet view remains read-only, and there is no per-citizen or scripted terminal.
- **One session.** The window owns a single shell. Closing the window ends it; if the shell
  exits, the terminal dims to a "session ended" curtain and one click starts a new one.

Four commands back it: `pty_create` (opens the shell, returns a session id, streams output
through a `Channel`), `pty_write`, `pty_resize`, `pty_kill`.

**Teardown kills the process group, not the shell.** portable-pty spawns the shell through
`setsid()` so the pty can be its controlling terminal, which makes the shell a session and
process-group leader whose PGID equals its PID. `pty_kill` therefore signals `-PID`
(SIGHUP, then SIGKILL after a 400ms grace) so every job the shell started dies with it.
Signalling the bare shell PID — the common shortcut — leaves background children orphaned and
still holding the pty open. The same teardown runs on window-destroyed and on process exit, so
closing BAUD never leaves a shell behind.

Output is base64-encoded over the IPC channel on purpose: a 4KB read can land in the middle of
a multi-byte UTF-8 character, and only raw bytes let xterm's decoder stitch it back together
across chunks. Lossy string conversion would corrupt the stream with replacement characters.

## Security posture

The monitoring half is deliberately locked down; the terminal is an explicit, bounded
exception to it.

- **Strict CSP.** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`.
  No remote origins, no CDNs, and **no inline scripts** — `script-src` stays `'self'`.
  `style-src` carries `'unsafe-inline'` for one reason: xterm.js styles its own DOM at runtime
  (row metrics, cursor, theme) with inline `style` attributes and an injected `<style>`
  element, and without the exception the terminal renders unusable. BAUD's own markup still
  uses zero inline `style` attributes — every colour comes from `theme.css`, including the
  terminal's, which is read back out of the `--baud-*` custom properties via
  `getComputedStyle` so the stylesheet stays the single source of truth.
- **No shell plugin.** The terminal is a named custom command with a PTY behind it, not
  `@tauri-apps/plugin-shell`. The frontend cannot ask BAUD to run an arbitrary program; it can
  only open a shell and forward the operator's keystrokes to it.
- **No filesystem plugin.** The frontend has no generalized file access of any kind.
- **No asset protocol.** Explicitly disabled; nothing on disk is addressable from the webview.
- **The fleet command is read-only.** `fleet_snapshot()` reads `DASHBOARD.local.json`,
  `.trinity/passport.json`, and `.ai_mail.local/.dispatch.lock` under the resolved root and
  returns a struct. It takes no arguments, so the frontend cannot even steer *where* it reads.
- **Core capabilities only.** `capabilities/default.json` grants the main window `core:default`
  — which already covers custom command invokes and channels — and nothing else.

The reasoning: BAUD renders the state of a fleet of autonomous agents, and a monitor that can
also act is a monitor you have to trust twice. So BAUD still does not act. The terminal does
not change that — it hands the keyboard to the human, which is the one actor already trusted
with the machine. Write *automation*, when it comes, will arrive as named commands with their
own explicit capability grants, not by loosening this baseline.

## Failure tolerance

Every per-branch read degrades independently. A missing dashboard, malformed JSON, an
unreadable directory entry, or a branch with no passport all fall back to defaults for that one
card. A single bad file can never break the snapshot.
