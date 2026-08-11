# BAUD

The AIPass machine room. A Tauri desktop app that watches the whole agent
fleet at a glance and puts every agent one click away — launch, switch,
resume, kill — all through a single operator terminal.

BAUD is a **pure reader** of the ecosystem: agents publish their own state
(dashboards, locks, transcripts), BAUD only looks. Its one interactive
surface is the operator's own shell, and every byte that shell runs was
either typed by the operator or is the one visible command line a card's
launch button writes on their explicit click.

## Launch

```
app/src-tauri/target/release/baud     # standalone release binary
cd app && npm run tauri dev           # dev mode with hot reload
```

Run it from anywhere inside an AIPass tree, or point it with `AIPASS_ROOT`.
Rebuild the release binary after code changes: `cd app && npm run tauri build`.

## The window

One column, no page scroll: header totals (citizens / dispatched /
interactive / unread mail / plans), the fleet strip, the operator terminal
(the only element that flexes), and a footer with the resolved root and
poll status. The fleet re-scans every 5 seconds.

### Cards

One citizen, one card. The card IS the report — nothing hides in tooltips:

- **Lamp** — the ground truth of activity. Amber pulse = dispatched (the
  machine is churning on a wake; `.ai_mail.local/.dispatch.lock` exists).
  Steady green = interactive (a live human-driven claude has its cwd in
  this branch — found by walking `/proc`, `-p`/`--print` runs excluded).
  Dim = idle.
- **Figures** — mail counted live from the branch's `inbox.json`; open /
  plans / todos from its `DASHBOARD.local.json`, plus its summary line and
  how fresh it is.
- **Git figure** — a permanent `⎇ git` count of uncommitted files,
  straight from the installed `git` binary (`git diff HEAD`, scoped and
  `--relative` to the branch dir — every `src/aipass` branch shares one
  repo, and a card only ever speaks about its own subtree). Dim zero when
  the tree is clean, amber when anything is uncommitted. Clicking it opens
  the diff tab.
- **Buttons** — `▸ resume` continues the branch's conversation, `fresh`
  starts a new one. Resume picks the right door automatically: `claude -c`
  when interactive history exists, `claude --resume <id>` when the only
  transcripts are headless dispatch runs (`-c` refuses those). A citizen
  with no transcripts at all shows a single `▸ claude`. `files` docks the
  branch's file tree.

Strip order: dispatched first, then interactive, then alphabetical.

### The reading room

Every number on a card is a door: clicking a figure opens the file the
number came from (inbox, dashboard, todos) in a read-only CodeMirror pane,
and the `files` button docks a lazy directory tree for browsing anything
else in the branch. Open files live in tabs beside the terminal — the
terminal never unmounts, hidden panes are just display-hidden, so claude
keeps streaming underneath while you read.

The changes badge opens the same kind of tab holding the branch's full
uncommitted diff in patch syntax. Diff tabs refetch every time they come
back to the front (a diff goes stale the moment the agent keeps working);
file tabs load once. Everything is read-only and fenced: the backend
canonicalizes every requested path and refuses anything outside the AIPass
root, viewers cap at 512 KB, binaries are refused. There are no write
commands in the codebase — committing stays in the terminal, through drone.

### Terminal

The operator's shell, centre stage — a real PTY running the user's own
shell with their own privileges. A `✕ kill` button sits in the corner
while a shell is live: same SIGHUP closing a terminal window sends, so a
running claude stays resumable from its transcript.

## The seat model (read this before extending)

BAUD has **one PTY — one seat**. A card click is a SWITCH by design: the
current seat's whole process group gets SIGHUP (shell, claude, everything),
a fresh shell opens, and the new agent sits down. Transcripts on disk make
every eviction resumable, which is why one terminal can hop between agents
instead of needing tabs.

Consequences worth knowing:

- Agents launched from BAUD are **mortal** — exactly one BAUD-hosted agent
  is ever alive.
- Agents living in **tmux rooms** are outside the blast radius entirely
  (different process tree; BAUD has no code path into tmux). Their lamps
  burn green through any amount of card-clicking.
- There is **no "max agents" constant anywhere in the code**. A "3 green
  lamps, third seat recycles" pattern is pure arithmetic: N tmux rooms + 1
  BAUD seat. Kill a room, the max drops; open more rooms, it climbs.

**Scaling path** (not built, deliberately): give cards their own tmux rooms
— click = create-or-attach `tmux` session per branch, switch = detach
instead of kill. Every agent becomes always-on and the seat limit
disappears. The current one-seat model is a choice (cheap, simple, one
claude's worth of RAM), not a ceiling.

## The two launch doors

- **Typed `claude` in a branch dir** goes through the AIPass boot shim
  (`~/.bashrc` function → @hooks `session_boot`): a continue/new menu,
  then claude execs **inside a tmux room** named after the branch. Those
  sessions survive closed windows, closed editors, everything short of
  `tmux kill-session`.
- **BAUD's card buttons** run `command claude ...` — the bash builtin
  skips the shim function, because the button press already answered the
  menu's question. Zero-touch, but seat-hosted (mortal).

The Telegram bot fleet is a third door that builds its own
`telegram-<branch>` rooms to wake agents from a phone; BAUD just sees the
resulting green lamps like any others.

## How BAUD reads the fleet

| Signal | Source |
| --- | --- |
| citizen | `.trinity/passport.json` exists |
| dispatched | `.ai_mail.local/.dispatch.lock` exists |
| interactive | `/proc` scan: argv[0] is `claude`, no `-p`/`--print`, cwd inside the branch |
| resume kind | `~/.claude/projects/<munged-path>/*.jsonl` — interactive transcripts carry `"type":"file-history-snapshot"` entries; headless dispatch runs never do |
| mail figures | `.ai_mail.local/inbox.json` message statuses — the dashboard's cached counts drift (12/17 cards were wrong, 2026-08-10) |
| other figures | the branch's `DASHBOARD.local.json` `quick_status` |
| files / viewer | `list_dir` + `read_file_text`, fenced to the AIPass root |
| changes badge + diff | the installed `git` binary, `diff HEAD --relative` scoped to the branch dir — the only git verb BAUD ever runs |

Every fallible read degrades to a default and records the failure in the
payload — one bad file never takes down the snapshot.

## Development

Stack: Tauri 2 (Rust backend, `portable-pty`) + React/TypeScript
(`xterm.js`) + one plain CSS file. Frontend types in `app/src/types.ts`
mirror the Rust structs in `app/src-tauri/src/lib.rs` — keep them in sync
by hand.

Checks (all expected clean before a build):

```
cd app/src-tauri && cargo test      # unit tests; compiling IS the Rust type check
cd app/src-tauri && cargo clippy    # lints
cd app && npx tsc --noEmit          # TypeScript type check
```

There is no seedgo audit lane for this repo yet — BAUD is Rust+TS while
seedgo speaks AIPass Python. Until a per-language diagnostics story exists
for `projects/`, the three commands above are the audit.
