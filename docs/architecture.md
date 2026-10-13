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
breadcrumbs: the screens, the transport seam, the Rust commands, the host lanes,
the palette, the build lanes, and the entry points. This file is the *why* and
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
| mail figures | `.ai_mail.local/inbox.json` message statuses — the dashboard's cached counts drift (12 of 17 cards were wrong when checked, 2026-08-10) |
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
