# BAUD architecture

How BAUD reads the fleet and the three rules everything else follows from.

BAUD is the AIPass desktop: one window that holds the whole citizen fleet and
puts every agent one click away. It is a Tauri 2 application — a Rust backend
in `app/src-tauri/`, a React + TypeScript frontend in `app/src/` — and Linux is
the platform it actually works on (the activity scan reads `/proc`, the camera
button speaks XDG portal; on other targets those two degrade to "nothing
running" and an honest error).

**Looking for where something lives rather than why it works? Read
[MAP.md](../MAP.md) first** — every piece of this repo in one screen of
breadcrumbs: the entry points, the transport seam, the host lanes, the palette,
the build lanes, and a link to the page that places each face's files. This file is the *why* and
it is long; the map is the *where* and it is not.

Three sentences of doctrine, because everything else follows from them:

- **The fleet view reads.** `fleet_snapshot` takes no path arguments, writes
  nothing, and every fallible read degrades to a default instead of failing the
  snapshot.
- **The terminal is the operator.** The seat is one PTY running the operator's
  own shell at their own privileges. BAUD types into a terminal only on a click,
  and only the command lines documented below. (Two other pane kinds run their
  own PTYs: monitor panes, which have no keyboard at all, and help shells, which
  do.)
- **BAUD edits config, it does not own it.** Two commands write files
  (`agent_settings_write`, `baud_settings_write`) plus one flag file
  (`hooks_sound_set`). Everything they touch belongs to someone else, so the
  writes are surgical and refuse rather than guess.

## How BAUD reads the fleet

| Signal | Source |
| --- | --- |
| citizen | `.trinity/passport.json` exists |
| manager | that passport's `identity.citizen_class` reads `manager` |
| roster tabs | the same per-project scan, run over every project in the census |
| dispatched | `.ai_mail.local/.dispatch.lock` names a pid that is alive (the dispatch monitor; `/proc/<pid>` stat'ed directly) |
| interactive | `/proc` scan: argv[0] is `claude`, no `-p`/`--print`, cwd inside the branch |
| resume kind | `~/.claude/projects/<munged path>/*.jsonl` — interactive transcripts carry `"type":"file-history-snapshot"` entries within their first 64 KB; headless dispatch runs never do |
| sub badge | `subagents/agent-*.jsonl` freshness (async agents, 180s) plus unmatched `Agent`/`Task` spawn calls in the transcript tail (blocking agents); sessions idle over 15 minutes are skipped |
| mail figures | `.ai_mail.local/inbox.json` message statuses — the dashboard's cached counts drift |
| plans / todos / age | the branch's `DASHBOARD.local.json` |
| room | one `tmux list-panes -a` per snapshot: session names, plus the cwd of every pane running `claude` (which is what finds sessions BAUD did not create) |
| git figure and diff | the installed `git` binary, `diff HEAD --relative -- .` in the branch directory |
| header `changes` total | the same binary, `status --porcelain -uall` at the seated project root — untracked files included |
| projects | sealed `<NAME>_REGISTRY.json` census; fleet dir from the registry's own `branches[].path` |
| files and viewer | `list_dir` + `read_file_text`, fenced to the seated project's root |
| terminal links | OSC 8 `file://` hyperlinks and plain-text mentions, both through the fenced `resolve_paths` |
| notifications | `<project root>/.aipass/notifications.jsonl`, written by ai_mail |
| hook sounds | the `aipass-hooks-muted` flag file in the OS temp dir |

Every fallible read degrades to a default and records the failure in the payload
— one bad file never takes down the snapshot.

Paths in the two sections below, the type seam and the Rust backend, are under `app/`.

## The type seam — TypeScript mirrors Rust BY HAND

**`src/types.ts` (489 lines) is written by hand to match the Rust structs.
Nothing generates it and nothing checks it.** Change a `#[derive(Serialize)]`
struct in `src-tauri/src/` and you must change `types.ts` in the same sitting —
the compiler will not tell you.

- Each mirrored interface says which struct it mirrors, in its doc comment:
  `/** Mirrors \`FileText\` in src-tauri/src/lib.rs. */`. That comment is the
  index — grep `Mirrors \`` to list every mirrored pair.
- Some interfaces mirror **nothing**: they are the phone's own shapes, answered
  by @api rather than by Rust (`RootEntry`, `GitChangeRows`, `FeedWindow`,
  `GitChangeCount`). Their docs say so, and say why.
- Optional fields marked *phone-only* exist because one face's backend sends a
  key the other's does not (`floor` on `DirWindow`/`FileText`).
- **Backlog, not built:** `tauri-specta` would generate this file from the Rust
  types and delete the hand-mirroring rule. Named here so the seam is findable
  the day someone folds it in.

---

## Rust — the desktop's backend, `src-tauri/src/` (6,644 lines)

| File | One line |
|---|---|
| `lib.rs` (1768) | The root: shared constants, `BranchStatus` and `FleetSnapshot`, `run()`, and the **command registry** (`generate_handler![...]`, 29 commands; `run()` builds only with the `gui` feature) — the canonical inventory of what a face can invoke. About 430 lines of it are code; the rest is the crate's test suite, which stayed here when the lanes left. |
| `cli.rs` (628) | `baud --snapshot` and the rest of the headless surface. Every outcome serializes in full even when it failed, and the exit code agrees with the payload. |
| `rooms.rs` (515) | tmux sessions: the name sanitizer, the pane scan, kill, capture, and the send door that types but cannot submit. |
| `sessions.rs` (397) | Who is actually awake — `/proc` for the processes, transcripts for what they are doing, and the subagent count. |
| `fleet.rs` (299) | One pass over the branch directories, one snapshot out. Every fallible read degrades to a default for that card and never fails the poll. |
| `reads.rs` (282) | The read surface: directories, file text, git changes and diffs — all behind `fenced_path_in` against the seated root. |
| `projects.rs` (239) | The census and the seat: registry seals, discovery, `ActiveProject`. |
| `pty.rs` (797) | Terminals and monitors: spawn, write, resize, kill, the shutdown hook that detaches tmux rather than killing it, and the frame coalescer that gathers pty reads into one message per 60Hz frame. |
| `settings.rs` (762) | Reads and surgical writes of other owners' config files. Refuses rather than guesses. |
| `memory.rs` (728) | @memory's rollover config, edited from here. |
| `notifications.rs` (155) | Reads the feed file off disk. |
| `screenshot.rs` (148) | The compositor capture. Desktop-only by nature. |
| `main.rs` (6) | Calls `lib.rs::run()`. The desktop app, so it builds only with the `gui` feature. |
| `bin/baud_cli.rs` (27) | `baud-cli`: hands its arguments to `run_headless` and exits with its code; with no verb it prints the six and exits 2. Built `--no-default-features`, it links no GTK. |

The six lanes above were split out of `lib.rs` on 2026-08-18 and are **glob-imported
straight back into it** (`use rooms::*;` and friends). That is deliberate: every call
site, and the whole test suite, names these items exactly as it did when they all
lived in one file. If you cannot find a function, `grep` the directory rather than
the file — the name did not change, only its address.

**The `gui` feature** (default on) gates tauri, the opener plugin, the terminal, the
screenshot portal, every `#[tauri::command]` wrapper and `run()`. With it off,
`memory`, `notifications`, `pty`, `reads`, `screenshot` and `settings` drop out, and
what is left — `cli`, `fleet`, `projects`, `rooms`, `sessions` — is the reader
`baud-cli` is built from.

Also: `Cargo.toml` (MSRV 1.77.2; the `gui` feature and the two binaries), `tauri.conf.json` (window, CSP, bundle off by
design — no installers, deliberately), `capabilities/` (what the webview is
allowed to call), `build.rs`, and two directories nobody edits: `gen/` (tauri's
own) and `target/` (cargo's).
