# BAUD

BAUD is the AIPass desktop: one window that holds the whole citizen fleet and
puts every agent one click away. It is a Tauri 2 application — a Rust backend
in `app/src-tauri/`, a React + TypeScript frontend in `app/src/` — and Linux is
the platform it actually works on (the activity scan reads `/proc`, the camera
button speaks XDG portal; on other targets those two degrade to "nothing
running" and an honest error).

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
binary, not installers. Last built 2026-08-12 18:52, current through m12 —
rebuilt with the room-end fixes, because the launcher's binary is what the
operator actually opens tomorrow. The desktop launcher
(`~/.local/share/applications/baud.desktop`) execs this binary directly, so a
rebuild IS the deploy; its `Path=` seats the process inside the AIPass tree,
which is how the release app's ancestor-walk finds its anchor.

## `--snapshot` — the same fleet read, without a window

The binary has a second entry point. `--snapshot` prints one fleet read as JSON
on stdout and exits, opening no window and touching no tauri state:

```
baud --snapshot [--project <name>]
```

It exists so that **"which agents are alive" has exactly one implementation.**
The phone arc puts a host API in front of the same fleet (DPLAN-0300), and the
alternative was a second room-judgment written in Python — which would drift
from this one, and on the day it drifted neither answer could be trusted. One
binary rather than a separate `baud-snapshot` tool for the same reason a step
further out: a second artifact is a second version that can silently disagree
with the GUI, and the release pin is one binary.

- **stdout** is always one `FleetSnapshot` object, whole and newline-terminated
  — the same shape the window's `fleet_snapshot` command returns. A failed read
  is still a full envelope with `error` set and `branches` empty, never partial
  output and never nothing.
- **`--project`** takes a name from BAUD's own census, which is case-sensitive
  and comes from the `<NAME>_REGISTRY.json` seal — `AIPASS`, `BAUD`. An unknown
  name is refused rather than defaulted to the anchor: quietly reading the wrong
  project is how a remote verb ends up acting on a session nobody named. With no
  `--project`, the anchor is read; the window's default is the *seated* project,
  which does not exist in a process with no seat.
- **Exit codes.** `0` a real read (`error` is null) · `1` the snapshot could not
  be produced, and stdout carries a valid envelope explaining why · `2` usage
  error, and stdout is empty. So a caller may parse stdout unconditionally and
  use the code as the cheap check. Failures also print the reason to stderr.
- **It resolves the anchor by walking up from the working directory**, exactly
  as the window does, so a caller whose CWD sits outside the tree gets exit 1
  and must either run inside it or set `AIPASS_ROOT`.

## The window

One column, no page scroll: header, fleet strip, workbench (the only element
that flexes), footer.

**Header, left to right.** The `BAUD` wordmark and the project chip; then the
totals (citizens, dispatched, interactive, unread mail, plans, changes), the
`❯_` terminal button, two monitor traffic lights (`prax`, `commons`), the
camera, the bell, BAUD's own settings gear, and the zoom chip.

**`❯_` opens a working shell in a tab**, seated at the project root — the
global one. It follows the project chip: reseat the view and the next click
opens the new root, and it stays disabled until a snapshot names that root
rather than guess. Every card carries the same button seated in its own branch
directory instead. These are plain shells with nothing typed into them — not
rooms, not agent seats — and they are keyed by directory, so a re-click brings
the open one forward and a project shell can never collide with a branch's.

**`changes` is not the sum of the cards**, and the difference is the point. A
card asks `diff HEAD` about its own subtree, which sees tracked files only; the
header asks `git status --porcelain -uall` about the whole seated repository,
so files git has never seen — a brand-new module, the most interesting change
in a tree — are counted there and nowhere else. Ignored paths (`target/`,
`node_modules/`, `dist/`) never reach it. A failed read shows `—`, never `0`:
a zero would claim the tree is clean when we simply do not know.

**Footer.** The resolved project root, and the poll status — how long ago the
last snapshot landed and the current cadence.

The fleet polls every 5 seconds by default; the interface settings can move that
to 2, 10 or 30 seconds, and the change takes effect on the spot. The per-card
git figure keeps its own slower 15-second tick, which is not configurable — a
subprocess per card per tick is real work and uncommitted-file counts do not
move second to second.

**Zoom.** The `− 100% +` chip scales the whole window, terminal included;
`ctrl +` / `ctrl -` / `ctrl 0` and ctrl+scroll do the same, captured at the
window so they beat the focused shell. The level persists in `localStorage`;
clicking the percentage resets it.

**The project switcher.** The chip beside the wordmark names the project the
fleet view is seated in. A project is a directory sealed by a
`<NAME>_REGISTRY.json`: the filename stem is the canonical name, and the fleet
directory is the parent of the registry's own first `branches[].path` — no
layout guessing. BAUD's census is the anchor, its `projects/*`, and the anchor's
siblings; a seal that lists no branch paths, or whose branches sit at the
project root, never makes the menu. Discovery is backend-owned: the frontend
picks a NAME from the census and there is deliberately no way to hand the
webview-facing commands a path, so seating elsewhere moves the read fence rather
than weakening it. Reseating empties the reading room (its tabs point where the
fence now refuses to read), closes any open settings panel, re-reads BAUD's
settings from the new root, and re-polls immediately. The terminal is untouched.

## Cards

One citizen, one card, under the strip's own heading — **Agent Passports**,
because that is what a card reads: the branch's passport, not its process.
Strip order: dispatched first, then interactive, then alphabetical. The strip
scrolls sideways rather than wrapping, so the workbench below never loses
height as the fleet grows.

**Three tabs decide whose passports are on show.** `current project` is the
seated project's own fleet — every branch it has. `live agents` and
`dispatched` are census-wide: they sweep every project BAUD discovered and
show only agents actually working, so two managers in two trees sit one click
apart without the project chip moving. That matters because the terminal
outlives a project switch by design — the seat and the conversation are
independent, and the roster keeps it that way. Working means a live
interactive claude or a dispatch in flight; an idle room is a place, not an
agent at work, and listing it would bury the cards that matter. The sweep
costs one `/proc` pass and one tmux round-trip for all projects — the same two
storms a single snapshot already pays — and only polls while a roster tab is
open.

**A roster card from another project is a smaller card, deliberately.** Every
fenced door — `files`, `watch`, the gear, `?`, the `⎇ git` figure and the
click-through on every other figure — reads under the seated project's root
and would simply refuse from elsewhere, so a foreign card does not offer them.
Its figures still read true (the sweep gathered them); they are numbers rather
than doors. What it keeps is what genuinely works from anywhere: the launch
door and `❯_`. An amber project tag names its tree.

The side effect turned out to be the better feature: **the full card is a seat
indicator**. Whichever card is wearing all its doors is the project you are
seated in (Patrick, 2026-08-13, accepting the design on those grounds). Making
the fenced commands project-scoped would fill every card in and cost that
signal — it stays this way on purpose, not for want of the wiring.

- **Lamp** — amber pulse: dispatched (`.ai_mail.local/.dispatch.lock` exists).
  Steady green: interactive (a live claude with no `-p`/`--print` has its cwd
  inside the branch). Dim: neither.
- **★ manager mark** — beside the name, amber, on citizens whose passport says
  `identity.citizen_class` is `manager`: a project's first agent and its owner,
  the only class holding git write, the feedback channel to @devpulse, and
  watchdog. It sits with the name rather than the badges because class is what
  an agent *is*, where the badges say what it is *doing*. One per project by
  construction, so the mark stays rare and the hover does the teaching. Read
  from the passport itself — no passport, unreadable, malformed, or any other
  class all read as "not a manager", because an ownership mark is a claim BAUD
  only makes when the file makes it.
- **Badge** — `dispatched`, `live`, or a quiet `room` when a tmux room exists
  with nothing live in it. A trailing `⧉` means the live session is one BAUD
  did not create; hovering names it.
- **Sub badge** — amber `N sub` while sub-agents are running inside the branch's
  session. Sub-agents never appear in the process table (they run inside the
  parent claude), so the count comes off disk: async agents by the freshness of
  their own `subagents/agent-<id>.jsonl` (180-second window), blocking agents by
  `Agent`/`Task` spawn calls with no matching result in the transcript tail.
  Only transcripts written in the last 15 minutes are consulted.
- **`?`** — opens a help terminal for this branch (see *Help terminals*).
- **Gear** — opens this branch's settings panel (see *Settings*).
- **Figures** — every number is a door. `mail` and `open` are counted live from
  `.ai_mail.local/inbox.json` and open it; `plans` comes from
  `DASHBOARD.local.json` and opens it; `todos` comes from the dashboard too but
  opens `.trinity/local.json`; `⎇ git` is a count of uncommitted files and opens
  the diff tab. The dashboard's summary line is deliberately not on the card —
  it restated the same figures.
- **Age** — `updated <age>`, from the dashboard's `last_updated`, styled stale
  when it gets old.
- **Buttons** — `files` docks the branch's file tree. `❯_` opens a plain
  working shell in a tab, already seated in the branch directory — the same
  door the header's `❯_` opens at the project root. `watch` opens a read-only
  monitor pane scoped to this branch. Then the launch door: a branch with a live
  interactive claude in a session — its own room, or one BAUD did not create —
  shows a single `▸ attach`; otherwise `▸ resume` (when there is anything to
  resume) beside `fresh`, or a single `▸ claude` when the branch has no
  transcripts at all.

The `?`, the gear and the button row render only for citizens — a directory
without `.trinity/passport.json` gets a card, but no doors.

**What a launch button actually types**, one visible line, on the click:

```
cd '<branch dir>' && command claude --permission-mode bypassPermissions [-c | --resume <id>]
```

`command claude` skips the `~/.bashrc` boot shim — which intercepts `claude` and
`claude --permission-mode …` inside a `.trinity` directory and routes them
through @hooks' `session_boot` attach-first menu — because the button press
already answered that menu's question. Resume picks its own door: `-c`
when an interactive transcript exists, `--resume <id>` when the only history is
headless dispatch runs, which `-c` refuses. No model flag is ever passed; models
are set in the branch's own settings file (see *Settings*).

**That line is the terminal slot.** BAUD is terminal-agnostic by ruling
(Patrick, 2026-08-14): AIPass is the backend that does the work, BAUD is the face
that makes it clickable, and the terminal is a component wired into it — claude
today, and the intent is terminal *selection* the way model selection already
works. Everything Claude-specific about a launch lives on this one line; nothing
deeper in the app may assume which terminal is in the slot.

One deliberate absence follows from that: BAUD does not pass `--remote-control`.
Claude Code's Remote Control is a terminal-native convenience like attach — real,
worth using when it is there, never something the fleet depends on. It works
without BAUD's help: `/remote-control` typed inside a session puts that session
on the phone.

## Rooms and the seat model

Every agent's session lives in a persistent tmux room — `baud-<branch>`, or
`baud-<project>-<branch>` in a seated non-anchor project, so two projects'
same-named branches can never attach to each other's sessions. The room belongs
to the tmux server, not to this window; BAUD's terminal is a window into it.

- **Open a card** — `tmux new-session -A -s <room> -c <branch dir>`, chained
  with `set-option mouse on`. Creates on first visit, attaches after that.
- **Switch cards** — the old client is SIGHUPed, which for a tmux client is a
  detach. The agent you left keeps working.
- **Close BAUD** — every room loses its window. Sessions, monitors and builds
  keep running.
- **`⇠ detach` / `✕ end room`** — the terminal's corner buttons in a room.
  `end room` (`tmux kill-session`) is the ONE door that actually ends a session;
  its hover text names the exact tmux session the click will kill. The scratch
  shell (no card) keeps a plain `✕ kill`, which is a real SIGHUP to the process
  group — a claude running there stays resumable from its transcript.

**An ended room stays dead** (Patrick ruling 2026-08-12). Nothing in BAUD
reopens it: not the next poll, not a hot reload, not the next app launch. The
one door back is the operator opening that card again — a click on `attach`,
`resume` or `fresh` clears the mark and the branch behaves normally from then
on. The mark is local intent (`localStorage`, keyed per project and branch),
recorded only after tmux confirms the kill: a room that refused to die is still
alive, and BAUD says so instead of pretending. This exists because the ruling
was broken the day it was made — see *The startup agent* under Settings.

**Sessions BAUD did not create.** A branch whose own room is absent can still
hold a live agent: @hooks' boot shim seats a typed `claude` in `aipass-<branch>`,
the Telegram fleet wakes agents in `telegram-<branch>`. The snapshot reads panes,
not just session names, so those show up as the branch's `outside_room` and the
card's doors act on them: the badge wears a `⧉` and names the session on hover,
the launch door reads `▸ attach` (never a second claude in a branch that already
has one), and `✕ end room` ends that session. Before this, `end room` on such a
card targeted a `baud-<branch>` that did not exist — a silent no-op, which is
why @aipass looked immortal (Patrick-caught 2026-08-12).

A session is a candidate only when tmux reports one of its panes running
`claude` with its working directory inside the branch. The narrowness is the
point: a looser test would let BAUD adopt the operator's own tmux window and
type a claude command line into it. A claude install that reports some other
pane command simply never matches, and the card falls back to the behaviour it
had before. BAUD still CREATES only its own `baud-` rooms, and an existing
`baud-<branch>` always wins over an outside session.

The staged claude command is typed only where it can land at a prompt: into a
room this spawn just created, or one the snapshot says holds no live claude.
Attaching to a live claude types nothing — the click lands you mid-conversation.

**One PTY, one seat.** Rooms run in parallel; attention is singular. There is no
"max agents" constant anywhere in the code: N rooms plus one seat is arithmetic.

The tmux verbs in this codebase are exactly: `new-session -A`, `list-panes -a`,
`has-session`, `kill-session`, `set-option mouse`. Room lookups use tmux's `=`
exact-match prefix, and room names sanitize everything outside `[A-Za-z0-9_-]`
to `-`. `new-session -A` is what lets one code path both create BAUD's own room
and attach to a session someone else made.

## The terminal

A real PTY running `$SHELL` (falling back to `/bin/bash`) through portable-pty's
login-shell path, opened in the seated project's root. Output streams to
xterm.js base64-encoded, because a 4KB read can split a multi-byte character and
only raw bytes let xterm's decoder stitch it back together. Teardown signals the
whole process group — SIGHUP, 400ms of grace, then SIGKILL — so background jobs
are not orphaned. Scrollback is 5000 lines.

**Slash-command chips.** When the tmux session this terminal is attached to
holds a live interactive claude, `/memo`, `/prep` and `/compact` appear beside
the corner buttons. One click types the command, waits 150ms for the slash
palette to settle, then sends `\r` (a carriage return — claude's raw-mode input
treats a linefeed as text). The hover text explains what each ritual is for.
`/clear` is deliberately not a chip: the command that discards a conversation
keeps its typing friction.

The question is asked of **the session, not the seat** (m13). Until then the
chips gated on the seated project's live branch list, so attaching to a room in
another project — which the seat's cards know nothing about — made them vanish
from a terminal with a claude sitting right there in it. The snapshot now
carries `live_agent_sessions`, every tmux session on the machine holding a live
*interactive* claude, and the pty reports the session it actually attached to.
Interactive matters: a pane running a dispatched headless `claude -p` looks
identical to tmux, and has no chat box for a slash command to land in, so the
process table decides — the same judgment a card's own figure uses.

**Ctrl+click is a door**, on two layers. Claude wraps file citations in OSC 8
`file://` hyperlinks, and BAUD's link handler claims them (xterm drops non-http
links entirely by default). Plain-text paths in any output go through the
`resolve_paths` command: a mention only underlines if it resolves to a real file
inside the fence — the seated room's branch directory first, then the project
root. Both open in a reading-room tab at the cited line. URLs go to the system
browser through the opener plugin's url-only grant. Plain clicks stay tmux's;
only the ctrl-chord activates.

**Dropping a file** anywhere on the window puts its path (quoted if it needs it)
into the chat box, unsubmitted — the same thing dropping onto a real terminal
does.

## The workbench

Open files, diffs, monitors and help shells live as tabs beside the terminal.
The terminal is never unmounted — hidden panes are display-hidden, so claude
keeps streaming underneath while you read.

**The reading room.** Card figures and ctrl+clicked paths open read-only
CodeMirror panes; the `files` button docks a lazily-loaded directory tree.
The git badge opens the branch's full uncommitted diff in patch syntax, and diff
tabs refetch every time they return to the front (a diff goes stale the moment
the agent keeps working); file tabs load once. Every path the frontend sends is
canonicalized and must sit inside the seated project's root, viewers cap at
512 KB and flag the truncation, binaries are refused, and the tree skips `.git`,
`node_modules`, `target`, `__pycache__`, `.venv`, `dist`.

**Monitor panes (read-only).** The header's two traffic lights open
`drone @prax monitor run` (mission control, all branches) and
`drone @prax monitor run commons` (the live social feed); a card's `watch`
button opens `drone @prax monitor run <branch>` in its own `watch:<branch>` tab.
A light is green exactly while its tab exists, so the toggle, the tab's `✕`, the
pane's corner button and the monitor dying on its own all reset it through the
same door.

These panes have no keyboard, and the enforcement is doubled: xterm runs with
`disableStdin`, and the backend's `pty_write` refuses any session flagged
read-only. The command is composed backend-side from a fixed shape — the
frontend passes a target token, never a command line — and the token must match
`[a-z0-9_,-]+`, which is unit-tested against shell-smuggling shapes. Monitors
spawn through the login shell (`-l -c`) so `drone` resolves from the operator's
own PATH.

**Help terminals.** The `?` on a card opens a real shell seated in that branch
with the branch's help command already run — `drone @<branch> --help`, except
for `aipass`, which is the ecosystem's one routing exception and asks its own
binary (`aipass --help`). The keyboard is deliberately ON: the point is
continuing the investigation. There is no filter on what can be typed, because a
typed-input filter would be theater; the framing does the work, exactly as it
does for the scratch shell. Typing `exit`, or the pane's `✕ kill`, closes the
tab.

## The bell

ai_mail appends every notification event — mail delivered, agent waking,
dispatch finished — to `<project root>/.aipass/notifications.jsonl`, one JSON
object per line (`ts`, `kind`, `title`, `body`, `source`). Desktop toasts are
retired: ai_mail's notifier (`notify.py` 2.0.0, "Notification Feed Writer") has
no D-Bus and no notify-send path left in it, and no fallback that still toasts.

BAUD only reads that feed. The backend tails the last 256 KB, skips lines that
do not parse (a torn trailing write or a truncated first line must never take
the bell down), and returns at most 200 events; the bell then keeps as many as
the interface settings say. A missing feed is a quiet bell, not an error.

Nothing clears itself. The badge stays until the operator clicks **clear**,
which wipes the lot in one click. Clearing is local — a cleared-up-to timestamp
in `localStorage`, keyed per project — so the feed file is never written by
BAUD, and two BAUD windows never fight over read flags. Rows click to expand
from their two-line preview to the whole event.

The chime, when enabled, is synthesized with the Web Audio API — two short sine
notes — because the CSP allows no external assets and a sound file shipped
beside the binary is a sound that eventually goes missing. It fires only when a
poll brings an event newer than the previous poll's newest; the first list after
launch is history, not news.

## Settings

Two gears, three files, one doctrine: **BAUD is an editor of operator-owned
config, never its owner.**

### The card gear — one agent's claude settings

Writes `<branch>/.claude/settings.local.json`, claude's own file. Operators keep
permission blocks, MCP server lists, hooks and env in there, so the write is
surgical: the existing document is parsed, exactly three keys are touched, and
every other key is handed back untouched.

| Panel row | Key on disk |
| --- | --- |
| model | `model` |
| auto-compact | `autoCompactEnabled` |
| threshold | `autoCompactWindow` |

The patch is three-state, so "leave it alone" and "unset it" can never be
confused: a field absent from the patch is not touched, a field explicitly
`null` REMOVES the key, a field with a value sets it. Choosing **Inherit** is
the null case on all three dials — the key is deleted, not blanked. The panel
sends a field only when the operator's value differs from **what the file
says**, and an absent key reads as absent, never as the value claude would have
picked.

That last clause is load-bearing, and it was wrong until m15. Each dial used to
baseline an absent key against a guessed default, so a file carrying only
`model` opened showing *on, 350k*, matched what the operator wanted, produced no
difference to send, and left **save** disabled. The dial could be read but never
stamped — Patrick hit it on @baud's own seat, where a session ran with no
`autoCompactWindow` at all while the panel displayed 350k. The guess was also
untrue: claude's real threshold follows the model, so an opus-1m seat reading
"350k" was compacting near 1M, which is to say never.

Failure mode is refusal. A settings file that exists but does not parse as a
JSON object errors out and nothing is written — losing a deny-rule to a settings
toggle is the worst bug this file could ship, and overwriting what we cannot
read is never the safer choice. Writes land through a temp file in the same
directory and a rename, so a reader never sees a half-file. Keys come out in
file order (serde_json is built with `preserve_order` since m13), so a one-key
change no longer reshuffles a document somebody else wrote.

Model strings pass through opaque — which model ids exist is claude's business
and it changes without us. A model the file already carries that the panel does
not list stays listed verbatim rather than rendering as Inherit. BAUD never
passes a model on the command line — it writes the key in claude's own settings
file, and claude reads that file when a session starts in the branch, so the
choice is not tied to BAUD's launch button.

**auto-compact** is a three-position select — Inherit, On, Off — because a
switch has two positions and this dial has three. The **threshold** slider runs
100k–1M in 50k steps and reads `not set` while the key is absent; it starts at
350k purely as a slider position, a claim about nothing. Choosing **On** stamps
that threshold too, disclosed as a second pending change: `autoCompactEnabled`
alone would leave the cutoff at claude's model-dependent default, which is the
exact trap above. **Inherit** hands both keys back. **Off** leaves a stored
threshold parked — that is what the file says, and the panel does not edit what
it was not asked to. The `memory caps` row is a disabled placeholder and writes
nothing.

### The header gear — BAUD's own interface

Writes `<project root>/.aipass/baud.settings.json`, per seated project. The
backend treats the document as opaque: a shallow top-level merge, `null` removes
a key, and it hands the whole document back as written.

| Row | Key | Default when absent |
| --- | --- | --- |
| startup agent | `startup_agent` | none — BAUD opens nothing |
| poll every | `poll_interval_ms` | 5000 (menu: 2s/5s/10s/30s, accepted range 1s–300s) |
| bell keeps | `bell_max_events` | 200 (menu: 50/100/200, accepted range 1–500) |
| bell chime | `bell_sound` | off |

Absence and nonsense both fall back to the default — the file is
operator-editable by hand, and the app must keep running rather than poll every
0 ms. A stored value the menu does not offer stays listed instead of being
silently rewritten.

**Startup agent** fires once per app run, as soon as the first snapshot and the
settings have both landed, and only if the operator has not already picked a
card. It goes through the same `launch` door a card click uses, with the card's
own judgment: a live session attaches, a branch with history resumes, anything
else starts fresh. A named agent with no card in the seated project is a console
warning, not a fault banner.

Two things hold it back, and both exist because it resurrected an ended room the
day it shipped: BAUD is developed in the window it is used in, so every frontend
save hot-reloads the app, and a once-per-app-run guard held in a React ref is
re-armed by every one of those remounts. The guard now lives in `sessionStorage`
— one shot per app RUN, not per mount — and the startup agent refuses outright
to open a branch whose room the operator ended. `app/src/intent.ts` holds both
marks and nothing else; it is the only place in the frontend where an operator
decision is stored rather than derived.

**Hook sounds** is the one row that is not a setting of ours, and the panel says
so. AIPass hook sounds are muted by the existence of a flag file named
`aipass-hooks-muted` in the OS temp directory (@hooks' own switch: the file
exists = muted). BAUD is a second hand on that same switch — it flips on click
rather than on save, both directions are idempotent, the state is read live on
open because a shell or another window may have flipped it, and nothing about it
is mirrored into `baud.settings.json` where it would drift. The flag lives in
the temp directory, so it resets on reboot; that is the flag's design, not ours.

### The memory dials — @memory's config, edited from here

Below the interface rows sits a **memory** section reading
`<AIPass root>/src/aipass/memory/memory_json/custom_config/memory.config.json`
— @memory's file, shared by every citizen in the ecosystem. It carries its own
save button, deliberately: one button writing two owners' config is how a
poll-cadence tweak ends up silently rewriting the fleet's memory limits.

| Half | What it sets | When it takes effect |
| --- | --- | --- |
| entry caps | `entry_limits.entry_types.<type>.max_chars` — chars per entry | immediately; the enforcement hook re-reads the file on every memory write |
| keep-counts | `rollover.defaults.<group>.<container>.count` and `auto_compact_cap` | only after the operator runs `drone @memory rollover push` |

The panel prints that command and stops there. Pushing config out to seventeen
branches is @memory's job, not a side effect of closing a dialog. Per-branch
overrides (`rollover.per_branch`) are listed read-only behind a disclosure —
they are written *by* that push, and seventeen editable copies of the same
three dials is a panel nobody can read. Nothing is hardcoded: the caps, the
dials and the branch list are whatever the file says today, and an entry type
@memory adds tomorrow simply appears.

Two refusals guard the write, both stricter than the card gear's. A dial that
does not already exist on disk is **not created** — BAUD turns dials it can
see, and inventing structure in another agent's config is the cross-edit the
ecosystem forbids. And zero is refused for caps and counts: it is the one value
that reads as a valid number and silently breaks every memory write in the
fleet. Both refusals happen before a byte is written.

One honest cost, measured on a copy of the real 8 KB file rather than guessed:
moving one dial rewrites 2 of its 364 lines. One is the number. The other is
@memory's own `_note`, whose em-dash was `—` on disk and comes back as
literal UTF-8 — the same decoded string, spelled differently. Before serde_json
was built with `preserve_order` (m13, for both writers), that same edit
reshuffled 310 of 364 lines.

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

## How BAUD reads the fleet

| Signal | Source |
| --- | --- |
| citizen | `.trinity/passport.json` exists |
| manager | that passport's `identity.citizen_class` reads `manager` |
| roster tabs | the same per-project scan, run over every project in the census |
| dispatched | `.ai_mail.local/.dispatch.lock` exists |
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

## The command surface

`invoke_handler` in `app/src-tauri/src/lib.rs` is the canonical inventory —
26 commands, and nothing reaches the backend that is not on this list:

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
```

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
│   │   ├── App.tsx             window shell, tabs, launch, startup agent
│   │   ├── components/         cards, terminal, panes, panels, header tools
│   │   ├── host/               the transport seam — every host call, named once
│   │   ├── tokens/             the palette as data, and the CSS generated from it
│   │   ├── types.ts            hand-kept mirrors of the Rust structs
│   │   ├── intent.ts           operator decisions that outlive a remount
│   │   ├── age.ts              relative-age formatting
│   │   └── theme.css           the layout, written entirely in var(--baud-*)
│   ├── src-tauri/src/
│   │   ├── lib.rs              fleet scan, projects, files, git, rooms, command registry
│   │   ├── pty.rs              terminals and monitor panes
│   │   ├── notifications.rs    the bell's feed reader
│   │   ├── settings.rs         the two config writers and the hooks flag
│   │   ├── memory.rs           @memory's dials, read and surgically written
│   │   ├── screenshot.rs       the XDG portal client
│   │   └── main.rs             thin binary entry
│   ├── src-tauri/capabilities/ the permission grant
│   ├── dist/                   vite output (build artifact, not tracked)
│   └── README.md               a milestone-2-era description of the app; this file supersedes it
├── src/baud/baud/              @baud — the project's resident agent
├── tests/                      placeholder README only
├── .github/
│   ├── workflows/ci.yml        the audit lane, run by a robot
│   ├── workflows/release.yml   tag push -> tested build -> published release
│   └── actions/                the Ubuntu build deps, shared by both workflows
├── BAUD_REGISTRY.json          the project seal
├── LICENSE                     MIT, mirroring the AIPass repo's own
├── CLAUDE.md, AGENTS.md        agent startup instructions
├── .claude/, .aipass/          agent settings, prompt tiers, hooks
└── README.md                   this file
```

**`src/` is not old app code.** It is the AIPass agent scaffold for @baud, the
project's resident citizen: `apps/baud.py` is the standard auto-discovery CLI
entry point reached as `drone @baud`, with `apps/modules/` and `apps/handlers/`
still empty. `BAUD_REGISTRY.json` names `src/baud/baud` as its one branch, which
makes `src/baud` this project's fleet directory — seat BAUD in the BAUD project
and you get exactly one card.

**`tests/` is a placeholder.** Its README says so: BAUD's real tests live with
their stack, in `app/src-tauri/`. There is no Python surface here and no
frontend test runner installed.

**`CLAUDE.md` and `AGENTS.md`** carry the same startup protocol for the agent
working in this directory (read `.trinity/`, use drone, keep memories current);
they are agent instructions, not documentation of the app.

## Development

Stack: Tauri 2 with `portable-pty` and `ashpd` on the Rust side; React 19,
xterm.js and CodeMirror 6 on the frontend; one plain stylesheet. There are no
inline styles anywhere — the CSP forbids them.

`app/src/types.ts` mirrors the Rust structs by hand. Change one, change the
other.

### The palette is data

`app/src/tokens/tokens.json` holds the 18 `--baud-*` values, and
`npm run tokens` generates `tokens.generated.css` from it — imported before
`theme.css`, which is written entirely in `var(--baud-*)` and defines no
colours of its own. The generator is dependency-free and deterministic, so a
regenerate either produces identical bytes or a real diff. `tokens/index.ts`
exports the same values as a typed object for a face that cannot read a
stylesheet. Edit the JSON; never the generated CSS. The terminal panes still
read their theme back out of the computed stylesheet, so there is still no
second palette anywhere.

### Every host call goes through the seam

`app/src/host/` is the only part of the frontend that knows how a call reaches
the machine. `transport.ts` holds the one `invoke` in the application;
`index.ts` gives each of the 26 backend commands a typed function. Components
import from `../host` and never from `@tauri-apps` — the two exceptions are
`App.tsx` and `Zoom.tsx`, which use `api/webview` for file-drop and window zoom,
genuine desktop-window concerns rather than host calls.

The point is a second face: a phone client binds the same verbs to HTTP instead
of IPC and reuses these components rather than mirroring them. The seam has one
binding today and no runtime switch — a named boundary, not an abstraction over
something that does not exist yet.

**BAUD is terminal-agnostic** (Patrick's ruling, 2026-08-14). AIPass is the
backend that does the work, BAUD is the face that makes it clickable, and the
terminal is a component wired into it — with terminal *selection* intended, the
way model selection already works. Everything Claude-specific lives on the one
launch line in `App.tsx`; the seam names what BAUD does (`ptyCreate`, `roomKill`,
`readFileText`), never one terminal's flags.

Checks, all expected clean:

```
cd app/src-tauri && cargo test      # 58 unit tests; compiling IS the Rust type check
cd app/src-tauri && cargo clippy    # lints
cd app && npx tsc --noEmit          # TypeScript type check
cd app && npm run build             # tsc && vite build - the frontend must actually build
```

There is no seedgo audit lane for this repo: seedgo's checks target AIPass
Python branches, and BAUD is Rust and TypeScript. The four commands above are
the audit.

`.github/workflows/ci.yml` runs those same four as a robot on every push to
`main` and every pull request — two parallel jobs (`frontend`, `rust`) on a
pinned `ubuntu-24.04`, with clippy's warnings denied rather than merely
printed. The runner installs Tauri v2's Ubuntu prerequisites and **tmux**,
because two of the Rust tests spawn real detached tmux sessions; they are not
skipped when tmux is absent, they fail, so a green run always means the rooms
doctrine was actually exercised. Those prerequisites live in one composite
action, `.github/actions/linux-tauri-deps`, which the release workflow uses too
— the lane that tests a build and the lane that ships one cannot disagree about
what the build needs.

**The suite assumes no surrounding ecosystem.** Every test builds the tree it
needs in a temp directory; none reaches for the live AIPass root, and none sets
`AIPASS_ROOT`, which as a process-wide variable would race the tests running
beside it. That is not a preference, it is a bug BAUD already paid for: the
maiden CI run went red on two path-resolution tests that passed here only
because this repo happens to be cloned inside the AIPass tree. To check the
property by hand, run the test binary from outside that tree — `cd /tmp && env
-u AIPASS_ROOT <target/debug/deps/baud_lib-*>` — and expect the same green.

## Versions and releases

BAUD is versioned with semantic versioning. The current version is **0.1.0**,
declared in three files that must always agree — change one, change all three:

```
app/package.json                  "version": "0.1.0"
app/src-tauri/Cargo.toml          version = "0.1.0"
app/src-tauri/tauri.conf.json     "version": "0.1.0"   <- what the built binary reports
```

While the repo is private the version stays on `0.x`, and the leading zero is
the honest part: the operator-facing surface can still move.

| bump | when |
| --- | --- |
| patch — `0.1.1` | a fix, or a change the operator cannot see |
| minor — `0.2.0` | a new operator-visible capability; a milestone landing is the usual trigger |
| major — `1.0.0` | breaking what the operator already relies on. `1.0.0` is also the going-public line |

**A release is the compatibility pin.** BAUD ships packaged with AIPass as one
unit, and that unit pulls the latest AIPass release. So the release — not a
version range in a manifest — is the statement of which BAUD and which AIPass
are known to work together (Patrick's ruling, 2026-08-12).

**Cutting a release is one human step.** Tags are `v<version>`, so this one is
`v0.1.0`, and pushing that tag is the whole ceremony — `.github/workflows/release.yml`
does the rest: it runs the test suite, builds with `npm run tauri build` (the
same command the Development section calls the deploy), and publishes a GitHub
release named after the tag with `baud-v<version>-linux-x86_64` and a
`SHA256SUMS.txt` attached. It tests before it ships on purpose: a tag can be
pointed at any commit, and "it was probably green on main" is not evidence.

@baud has no git write, so @devpulse pushes the tag.

## How it got here

Eleven milestones over three days, 2026-08-09 to 2026-08-11, and two nights of
rulings answered after them:

| | |
| --- | --- |
| m1 | Tauri 2 fleet monitor, read-only |
| m2 | the terminal in the middle — PTY layer, xterm, centre-stage layout |
| m2.5–m4 | zero-touch switching, resume everywhere, kill button, the reading room |
| m4.5 | click-through figures — every card number opens its source file |
| m5 | the git changes figure and the diff tab |
| m6 | rooms — per-branch tmux sessions; the terminal becomes a window into one |
| m7 | the project switcher — seat the fleet view in any sealed project |
| m8 | the camera, drag-drop paths, and the sub-agent badge |
| m9 | auxiliary panes — the monitor toggles, per-card watch, the help door |
| m10 | the notification bell; desktop toasts retired |
| m11 | settings — the per-agent gear and BAUD's own interface gear |
| m12 | the room-end ruling — ended rooms stay dead, outside sessions surface and end |
| m13 | chips follow the session not the seat; the memory dials join the interface gear |

Along the way: whole-window zoom, ctrl+click terminal links, slash-command
chips, and the mail-count fix that reads the mailbox instead of the dashboard's
cache.

Milestones 1–12 are committed, and BAUD `v0.1.0` was tagged and released from
`main` on 2026-08-12. m13 is in the working tree, uncommitted — @baud has no
git write; @devpulse commits this project on Patrick's word.
