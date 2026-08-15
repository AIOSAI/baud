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

## The headless doors — the same answers, without a window

The binary has a second entry point. Each headless flag prints one JSON object
on stdout and exits, opening no window and touching no tauri state:

```
baud --snapshot     [--project <name>]
baud --end-room     <branch> [--project <name>]
baud --capture-room <branch> [--project <name>] [--lines <N>]
baud --send-room    <branch> [--project <name>] (--text <literal> | --key <NAME>)
```

One verb per process. Writing both is a usage error rather than a precedence
rule — a caller who asked for a read *and* a kill does not know what they asked
for, and guessing for them is how a read turns into a kill.

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

### `--end-room` — the kill seam

`room_kill` is a tauri command, reachable only from inside the running desktop,
so the host API had nothing to proxy: `/v1/verbs/kill` sat behind a gate that
named BAUD. This flag is that gate's key, and it is a **door onto the one
mechanism, never a second one**. `--end-room` and the desktop's *end room*
button both call the same `end_room_in`, which calls the same `room_kill_named`
— there is no `tmux kill-session` anywhere in the headless path. Patrick's 2026-08-10
ruling stands: one thing ends a session, because a second door eventually
disagrees with the first.

- **stdout** is always one `KillOutcome` object. `detail` and `error` are
  mutually exclusive by construction — exactly one is non-null, and which one
  matches the exit code, so a caller reading only one field can never be misled
  about whether it worked.
- **`ended` is not the same as success.** `ended: true` means this call ended a
  live session; `ended: false` with no error means there was nothing to end.
  Both exit `0` — killing a room that is already gone is the goal state, not a
  failure — but they are different facts and the phone shows different sentences.
- **An unknown branch is refused, not reported as nothing-to-end.** They would
  look identical in a `null` room and are opposites: one means the caller holds
  a stale or wrong name, the other means the goal is already reached.
- **Fenced on names, not paths**, like the read lane. A branch name that is not
  a single directory component is refused before anything resolves it, and the
  sentence says *why* — a refusal that reads "no such branch" invites a retry.
- **Exit codes** are the snapshot's, deliberately: `0` did what was asked · `1`
  refused, with a full envelope explaining why · `2` usage error, stdout empty.

**Exit 1 and exit 2 are not two flavours of "no".** A *structural* mistake —
a flag missing its value, two verbs in one line, no branch named — is exit 2:
whoever built the command line built it wrong, and it never ran. A *value* the
caller chose — a key name off the allowlist, a scrollback depth past the cap —
is exit 1 with a full envelope, because that sentence has to reach the
operator's screen rather than becoming "the invoker made a mistake". The host
API maps exit 2 to a 503 it owns; putting a phone's typo there would blame the
wrong party and tell the operator nothing.

```
$ baud --end-room cli
{"project":"AIPASS","branch":"cli","room":"baud-cli","ended":true,
 "detail":"ended 'baud-cli'","generated_at":"…","error":null}          # exit 0

$ baud --end-room cli
{… "room":null,"ended":false,"detail":"nothing live for 'cli' - already ended",
 "error":null}                                                         # exit 0

$ baud --end-room ../etc
{… "detail":null,"error":"branch name '../etc' is not a single directory
 component - this door takes names, not paths"}                        # exit 1
```

### `--capture-room` and `--send-room` — parked, revivable, and not the input path

**Nothing calls these today, and that is recorded rather than left to be
discovered.** They were built for a phone terminal that polled `capture-pane`
and repainted it; that design was cut before it shipped (DPLAN-0300 Amendment
1). The phone attaches a real client now, so keystrokes ride a PTY.

Both stay in the binary by @devpulse's ruling — working tested code is not
deleted on a late-evening say-so — on the condition that their status is
documented in the same breath, so *unused-but-shipped* never quietly becomes a
second door:

- **`--send-room` is NOT the phone's input path and NOT a general input door.**
  The attach PTY is the one door for input. This flag exists, works, and is
  routed to by nothing.
- **`--capture-room` earns its place on its own argument**: looking is a read,
  typing is a verb. Attach is operate-only *by nature* — a shell prompt has no
  reading half — so a capture is the only possible path to a look-don't-touch
  view under a read token. That is a real future, not a leftover.

Neither flag attaches: `capture-pane` observes, so nothing about the operator's
own view changes — no resize, no focus, no second client.

- **`--capture-room`** returns `{project, branch, room, pane, cols, rows,
  captured, detail, error, generated_at}`. `pane` keeps its escape sequences,
  because a monochrome mirror of a coloured screen is a different screen.
  `--lines` reaches N rows above the visible screen (default 0, cap 2000,
  **refused not clamped**).
- **`--send-room`** takes exactly one of `--text` or `--key`. They are different
  mechanisms, not two spellings of one: a literal is **typed** through
  `send-keys -l`, a key name is **interpreted**. A literal `C-c` in `--text`
  types those four characters; `--key C-c` presses the interrupt. Both-or-neither
  is refused, because guessing which one a caller meant is how a paste turns
  into a control code.
- **`--key` names come from a fixed allowlist** — `Enter, Escape, Tab, Up, Down,
  Left, Right, C-c, C-d, C-l, C-u, BSpace, PageUp, PageDown`. `send-keys`
  without `-l` interprets whatever it is handed, so an unbounded name would be
  an unbounded keystroke.
- **`--text` never appends a newline.** A paste alone can therefore never
  execute; running it stays a separate, deliberate act. This is BAUD's own rule,
  already written into `Terminal.tsx` for the desktop, carried onto the wire
  rather than reinvented for it. Proven by typing a command through the flag,
  capturing the room, and finding it sitting unexecuted at the prompt.
- **A room that is not live is refused**, not returned as an empty screen. One
  is a fact about the fleet; the other looks exactly like a dead agent.

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
│   │   │                       transport.ts = tauri IPC · transport.http.ts = /v1 over fetch
│   │   ├── phone/              the one-column face: shell, token door, reader, feed, verb chips, room doors, attached terminal, photo picker
│   │   ├── deliver.ts           the ONE quoting rule - a path, quoted if needed, wrapped in spaces, never submitted
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
│   ├── phone.html              the phone face's entry document
│   ├── public/                 the PWA manifest and its icons
│   ├── vite.config.phone.ts    the phone build — one alias, and that alias is the whole port
│   ├── dist/                   vite output (build artifact, not tracked)
│   ├── dist-phone/             phone bundle (build artifact, not tracked)
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

That second face now exists — see below. The seam has two bindings and still no
runtime switch: a build picks one, and nothing above the seam can tell which.

### The phone face — one column, read by default

`npm run build:phone` emits `dist-phone/`: BAUD in a single column, installable
to a phone home screen, built from **the same React components** as the desktop.

The entire port is one alias in `vite.config.phone.ts`. `host/index.ts` imports
`./transport`; that build resolves it to `transport.http.ts` — `fetch` against
@api's host API — instead of the tauri binding. The 26 typed verbs, the cards,
the bell and the palette are compiled unchanged. The proof is mechanical: the
phone bundle contains **zero** occurrences of `@tauri-apps`, and the nine `/v1`
routes it does contain came from the transport table alone — plus two doors that
are not table rows because they are not JSON request/response: the room socket
(`/v1/room/attach`) and the multipart upload (`/v1/files/upload`).

The seam is command-shaped and `/v1` is REST-shaped, so `transport.http.ts` holds
a table from command name to route, and holds it alone. Verbs the phone cannot
perform are refused **by name** with a reason (`pty_create` → "the phone has no
pty") rather than silently failing — a designed absence and a bug should not look
the same from a phone.

**No token is ever baked into the bundle.** The face opens on a paste-token
screen, proves the token against `/v1/whoami` before showing anything, and keeps
it in `localStorage`. A refused token and an unreachable server are reported as
different failures, because they send the operator to different places.

**Reads are not verbs.** The first cut got this wrong — every card callback was
wired to a handler that threw, so the face showed all seventeen agents and did
nothing at all. Opening a file and reading a diff were never verbs; they are
exactly what the read lane serves. Each card now carries a read row (diff,
readme, memory, dashboard, inbox) that opens a full-height reader, and the
card's own figures open the file they came from. A `feed` screen replaces the
desktop's drop-down shade: same events, cursor-keyed, and when the server
reports a `gap` the screen says so — a window that silently lost events looks
exactly like a quiet night, and those are opposite things.

**Three verbs, and refusal is a state rather than an absence.** The phone can
now *wake* an agent, *end a room* and *lock the machine's screen* — chips under
each card, plus one lock chip in the header, because there is one machine. Under
a read-scoped token every chip is **still there**, dimmed, carrying the sentence
that says why it will not fire; hiding them would make a designed absence look
exactly like a broken build. Patrick's own phone token stays read-scoped, so
that dimmed state is the everyday one, not an error path.

`wake` names a branch, a project and a message — and **no model**, because the
branch's own config decides what wakes in it (Patrick's ruling). The project
travels with the branch on both `wake` and `kill`: a room name carries its
project scope, and resolving it against anything else names a different room.

Three client-side guards sit in front of the destructive verb, and each one is
the client's job *precisely because the server must not rely on any of them* —
anyone holding the token can call the endpoint with no browser at all. They
narrow the accident, not the attack: scope, a screen that must actually be
visible (a tap queued behind a lock screen never ends a session), and a confirm
dialog that asks the platform to verify the person where it offers it. The
server is never told that a human confirmed, because a claim like that from a
client is worth nothing.

**Both halves are built; end to end is not proven yet.** The chips, the payloads,
the scope refusal and the confirm flow were proven with real clicks against a
stand-in that asks the *real* `/v1/whoami` for the scope — and `kill` was
deliberately never proxied upstream, because if the route had gone live mid-run
a test harness clicking *end room* would have ended a real session. @api's
`/v1/verbs/{wake,kill,lock}` now exist on their side (POST only; a `GET` is 405,
because a destructive action must never be a link), and `kill` reaches the
desktop through `--end-room` above. The live run of the whole chain is still
pending, and two payload details are still being reconciled between the two
sides; neither is written here as settled until it is.

**The terminal — attach, not repaint.** Each card carries the desktop's own
launch doors, and pressing one opens a real `xterm.js` client on a WebSocket
(`/v1/room/attach`) whose far end is a PTY running `tmux new-session -A -t
baud-<branch>` — the same command `pty.rs` runs on the desk. Two clients, one
session. Scrollback, colour, cursor position and full-screen programs all work
because nothing is reimplemented.

This replaced a repaint design that polled `capture-pane` once a second and
painted the result. Patrick cut it before it shipped: *attach needs to work just
like on desktop*. Repaint-polling shows a picture of the room that updates;
attach gives you the room.

- **A launch IS an attach**, exactly as on the desktop since m6. The modes stay
  `resume | fresh` — attach is not a third one — and a room with a live agent
  offers exactly **one** door, structurally: `roomDoors()` returns a
  single-element list for it, so there is no branch where a live room is also
  offered a resume.
- **The double-claude guard is ported, not re-solved.** A command line is typed
  only where it can land at a *prompt*; a room with a live claude has a message
  box instead, so bytes sent there become chat. `rooms.ts` quotes every rule
  back to the desktop line it came from.
- **Attaching needs OPERATE**, and that is a change from the repaint design:
  watching a picture was a read, but an attached room is a shell prompt with the
  operator's credentials at it. Under a read token the doors render **disabled
  with the reason** and **no socket is opened at all** — the refusal is not a
  dimmed button in front of a live connection.
- **Closing is free.** Disconnect sends SIGHUP to the tmux *client* — a detach.
  The session, the agent and the scrollback survive. Ending a room stays exactly
  one door (`--end-room`), and nothing in the sheet can reach it.
- **The phone sizes like the real client it is.** FitAddon measures the sheet
  and sends `{"type":"resize","cols","rows"}`. What the room does with that is
  no longer left to tmux's default — see the geometry section below.
- **The key bar writes real control bytes** (`0x03`, `0x1b`, `\x1b[A`), not key
  names. The old 14-name allowlist existed because `send-keys` *interprets* what
  it is handed; a stream interprets nothing, so the allowlist is not a loss.
- **Typing a line and running it are still two bytes.** The field writes the
  literal, and `\r` goes separately — the same property `--send-room` had to
  enforce, now free: nothing on this path can append a newline for you.
- **The attached card is frozen at the moment the door was pressed.** The fleet
  re-polls every ten seconds and hands down a new object each time; depending on
  it re-ran the attach effect per poll, opening a fresh socket and **re-typing
  the launch line into the room**. Caught by measuring the wire — the harness
  logged the same launch bytes twice in one attach.

**A room opens with two options, and each chained command carries its own
`-t`** (2026-08-15). `pty.rs` opens rooms with `tmux new-session -A` and then
sets `mouse on` and `window-size smallest` on that session by name.

The `-t` is right — explicit costs nothing and removes a question the code
cannot answer — but **it was not the bug, and this file said it was.** The
correction is worth more than the claim was.

A chained `set-option` with no target writes to whatever tmux considers the
*current* session. Under `-d` there is no attached client, so it lands
elsewhere and the room is left untouched — which is what the first probe here
measured, and on that basis this section asserted that no BAUD room had ever had
a scroll lane. Production never runs `-d`: it runs under a real PTY and
*attaches*, and the attaching client's current session **is** the room. Measured
in four shapes after @api said they could not reproduce it:

| shape | option lands on the room |
|---|---|
| with `-t`, attached (shipping) | yes |
| without `-t`, attached (the old build, production) | **yes** |
| without `-t`, detached `-d` (what the first probe did) | no |
| without `-t`, attached, another session created later | yes |

So the old build's rooms did get `mouse on`. The room @devpulse measured as
mouse-OFF was reached over the phone's attach lane, which set no options at all
until @api shipped them — a different hole, since closed on their side. The
lesson is the probe, not the flag: a shape that differs from production in one
switch can invert the result, and `-d` was that switch.

`room_argv()` still earns its place: a list of strings can be asserted, a
`CommandBuilder` handed to a pty cannot.

**Geometry — why `smallest`, measured across all three policies.** Patrick's
report was a tmux status bar that stacked copies of itself, typed messages
arriving mangled, and no scroll. That is one bug wearing three costumes: a
client whose grid disagrees with the window. Two clients, one room, and tmux's
default `window-size latest` means the window follows whichever client resized
last — so the desk steals the geometry on its next repaint while the pocket is
still holding 72 columns.

Measured with two real clients (200×50 and 72×44) attached to one room:

| policy | phone after attach | after the desk resizes again |
|---|---|---|
| `latest` (default) | fits | **210×51 — phone cannot hold it** |
| `smallest` | fits | **still fits** |
| `largest` | never fits | never fits |

`smallest` is the only policy where the phone always holds a whole window, and
it is not destructive: no client is kicked, and the window returns to the
desktop's size on its own the moment the phone detaches. The desk pays for it
only while a pocket is actually attached, which — cursor-first — is only while
someone is looking at one. The alternative on the table was `new-session -A -D`,
which detaches the *other* client on attach: also correct, one flag, but it
kills the desktop's pane instead of shrinking it, and it needs a change on the
host side. Gentler beat cheaper.

**What is fixed, and what is only *probably* fixed.** The size mismatch is real
and now prevented: under `latest`, a desk pane attached at 200×30 hands the
phone a 200-column window to render on a 72-column grid, which is text arriving
mangled. Reproduced, and gone under `smallest`.

The stacking status bar had a different cause, and the harness was right to
refuse to claim it. Driving the real bundle in a real browser against a real
room — mismatch present, under repaint load — the banner drew exactly **once** in
every policy, including the broken one. It could not reproduce, and the reason is
now known: the phone's attach lane spawned its tmux client with no controlling
terminal, so `TIOCSWINSZ` had no recipient, the PTY was born 0×0 and the client
fell back to 80×24 *forever*. Eighty columns painted into a 46-column screen is
the mangling and the staircase both. Fixed on the host side (@api, 2026-08-15:
`login_tty` acquisition plus an initial winsize before spawn), and Patrick's
verdict on the corrected stack was *"this is much better. the view looks right.
scrolling work."*

Two things worth keeping from that. The resize frames were correct all along —
they were landing in a room with nobody home to hear them — so the honest
"not reproduced" was the difference between a fix and a coincidence. And the
harness could never have caught it: its stand-in spawns the client through
`pty.fork()`, which *does* give a controlling terminal, so the harness was
structurally incapable of having the bug it was being asked about.

**Scrolling a full-screen TUI.** Claude Code fills the screen, so there is no
local scrollback to swipe — the history belongs to tmux, not to the phone's
xterm. Scrolling therefore means sending the room a **wheel event** and letting
tmux's copy-mode do the work, which is why `mouse on` is a prerequisite and not
a nicety.

- **A finger pan is translated into SGR wheel reports** (`ESC [ < 64|65 ; col ;
  row M`), paid out in notches: the pan is divided by the room's real cell
  height (measured off the rendered rows) times tmux's five lines per notch —
  read off `list-keys`, not assumed — so text tracks the thumb at roughly 1:1.
  The remainder carries between moves, or a slow drag scrolls nothing and reads
  as broken. Finger down uncovers what came before, which is a wheel *up*.
- **The coordinates are the cell the finger is on**, because tmux reads them to
  decide which pane a wheel event belongs to.
- **It refuses to write when the room is not listening for a mouse.** Those
  bytes are only a scroll if something is watching for one; otherwise they are
  *text*, and `[<64;38;20M` would land in claude's input box. That is the exact
  mangling this round set out to end, and it would have been BAUD doing it. A
  room with no mouse lane scrolls the local xterm buffer instead and the chip
  says why.
- **The browser does not get the down-swipe.** Reaching back through history is
  a downward pan, which is exactly the gesture Chrome claims for
  pull-to-refresh, so the room scrolled while a reload spinner argued with it.
  `overscroll-behavior-y: contain` on `html`/`body` kills the refresh action
  without touching ordinary scrolling, and `touch-action: none` on the terminal
  host stops the browser interpreting the pan at all — `preventDefault` alone is
  not enough, because a browser can claim a gesture at `touchstart`, before the
  first move is ever delivered. Taps still fire, so focusing the terminal is
  unaffected.
- **A pan travels 3× the thumb** (`PAN_ACCELERATION`). Tracking the finger
  exactly is right for a document you are reading and wrong for scrollback you
  are reaching *back* through, where the thumb runs out of screen long before
  the history runs out. At 3× one comfortable swipe is about a screenful. A feel
  constant, not a correctness one.
- **The `↑`/`↓` chips are still arrow KEYS, relabelled `↑key`/`↓key`.** A thumb
  read them as scroll and got a stale prompt stuffed into the room's input box —
  which then rode out attached to Patrick's next message, because send ships the
  *box*, not the field. They are not repurposed, because claude's menus are
  navigated with arrows and a phone that cannot answer a permission prompt is
  worse than one that cannot scroll. The fix is that scroll now has its own
  clearly different pair (`▲`/`▼`) sitting to their left, and a gesture.

**Sending a photo — the path is the delivery.** The terminal sheet has a
`photo` control: it opens `<input type="file" accept="image/*">`, which on
Android offers the camera *and* the gallery with no native code and no
permissions dance. The bytes go to `POST /v1/files/upload` as multipart with the field named
**`image`** (operate scope, the server names the file — a phone-supplied
filename is untrusted), and the response's **absolute path is the entire
product**.

That field name is written down here because it is the detail that broke.
The contract said "multipart body, one image" and never pinned it; @api built
`image`, this built `file`, and the first real photo from Patrick's phone came
back `422 {"loc":["body","image"],"msg":"Field required"}`. Neither harness
could catch it — a stand-in speaks the spelling its own author believes in. A
wire detail with two possible spellings has to be read off the other side, never
inferred. The phone then types that
path into the already-open socket.

This is not a new mechanism; it is the desktop's, reached from a pocket.
`screenshot.rs` line 3 states it: Claude Code reads images by path, so "send a
screenshot" means get bytes onto disk and type where they landed.

- **One quoting rule, in `deliver.ts`.** It was inline in `App.tsx` until the
  phone needed it; a rule with shell semantics that exists twice is a rule that
  drifts, and the drifted copy does not look wrong — it mis-escapes a path and
  the operator's line quietly means something else. The camera button, the drop
  handler and the photo picker all call the same `deliveryText()`.
- **Quoted only when needed, wrapped in spaces** so the path joins whatever the
  operator was already typing.
- **Never submitted.** No newline exists anywhere on this path. Enter stays the
  operator's keystroke — the third time that rule carried in one evening, which
  is what made it doctrine.
- **A failed upload types nothing at all**, and says which half broke. An
  operator who believes a path is in their line will press Enter on it.
- **The server's sentence survives, whatever shape it arrives in.** `/v1`
  documents one error envelope, but the validation layer in front of it has its
  own (`{"detail":[{"loc","msg"}]}`) — and reading only the documented one left
  the phone showing `HTTP 422` while that same response body named the field and
  the fault. The status line is the last resort, never the first.

**A dropped write is never silent** (2026-08-14, found live). Patrick reported
that the phone "would not send" — he typed a message, pressed send, and the
field emptied into nothing. The wire and the TUI were both innocent: this was
client state. Opening the photo picker hands the screen to the OS gallery, the
PWA goes to the background, and the platform closes the WebSocket underneath a
sheet that still looks attached. Every control then failed the same way and said
nothing, because the byte writer *guarded* a dead socket and returned nothing, so
each caller went on to claim success.

- **The writer reports.** It returns whether the bytes reached an OPEN socket.
  The guard was always right; returning nothing was the bug.
- **The operator's text is the operator's** until the bytes are known to have
  gone. `send()` writes first and clears second. A failed send leaves the line
  exactly where it was, with a sentence. (Clearing the field was what made it
  look like it had sent — the emptiness was the whole illusion.)
- **`delivered` may only render over bytes that actually went.** A photo that
  outlives its socket is **queued** against the next open one and says `saved ·
  <path>` — the upload is the durable half, the file is really on disk, and
  nothing throws it away or lies about it.
- **Detached is a state, not an error.** The sheet says so, offers a `reattach`
  control, and heals itself on `visibilitychange` — returning from the picker is
  precisely the uncovered moment. Cursor-first is unchanged; this is the other
  half of that sentence, which was missing.
- **A reattach never re-types the launch line.** Once per sheet, never once per
  socket — otherwise the double-claude hazard walks in through the back door
  after all the work spent closing the front one.
- **Direct tap-and-type is untouched** — same writer, same bytes, nothing added
  between the keyboard and the room (@devpulse's constraint, mid-round: it is
  what Patrick instinctively reaches for). It only gained the sentence, and it
  is the path that needs it most: the terminal echoes nothing back locally, so
  typing into a closed socket looks exactly like typing into an open one.
- This is learning #389 again, one layer down. A scope-refused UI must be
  disabled *with a visible reason* rather than hidden, because a silent refusal
  is indistinguishable from breakage — and that does not stop being true when
  the failure is the client's own transport rather than the server's rule.

**Why these two guards and no others** (Patrick's posture ruling, 2026-08-14).
The token is the wall: his laptop, his network, the server dies when the laptop
does. Security gets its own pass later, so nothing here is gated on caution —
only on plumbing. The confirm tap and the dark-screen check stay because they
protect a *thumb*, not data: a pocket tap ending a live session is a real cost
with no upside. Scope stays because it is the server's rule, not the client's.

The desktop's remaining verbs stay withdrawn on the phone — shell, settings,
watch — because each wants a pty or a native window on the machine itself. Cards
render with `readOnly`, which suppresses exactly that button row. The push hooks
(`src/phone/push.ts`) are still exported, empty and inert — a reservation with
its gate named, the way `App.tsx` holds the terminal slot. There is also **no service worker**: an
offline cache of a live fleet would show stale aliveness, which is the one lie
this system keeps paying to avoid.

The read lane is fenced on **names, not paths**. The host API takes a branch and
a file name and has no path parameter to abuse, so `transport.http.ts` refuses
an absolute path outright rather than stripping its leading slash and asking for
a branch called `home`.

**Serving is settled and live.** @api took the zero-CORS shape: their server
mounts `dist-phone/` on its own origin, so `npm run build:phone` *is* the
handoff — rebuild is deploy, the same contract the release binary has. There is
no artifact to pass and no CORS allow-list to misconfigure. The page itself is
unauthenticated on purpose: a top-level browser navigation cannot carry an
`Authorization` header, so gating it would mean inventing a second, weaker auth
system beside the bearer wall to protect public code that renders a token door.
Every byte of data stays behind `/v1/*`.

Patrick's S24 reached it over the tailnet on 2026-08-14 and rendered the fleet.
`npm run dev:phone` still proxies `/v1` from port 1421 for a local build loop.

**BAUD is terminal-agnostic** (Patrick's ruling, 2026-08-14). AIPass is the
backend that does the work, BAUD is the face that makes it clickable, and the
terminal is a component wired into it — with terminal *selection* intended, the
way model selection already works. Everything Claude-specific lives on the one
launch line in `App.tsx`; the seam names what BAUD does (`ptyCreate`, `roomKill`,
`readFileText`), never one terminal's flags.

Checks, all expected clean:

```
cd app/src-tauri && cargo test      # 81 unit tests; compiling IS the Rust type check
cd app/src-tauri && cargo clippy    # lints
cd app && npx tsc --noEmit          # TypeScript type check
cd app && npm run build             # tsc && vite build - the frontend must actually build
cd app && npm run build:phone       # the phone face - same components, HTTP transport
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

It has cost that twice now: the `--snapshot` project-census test made the same
mistake in a new place, because the only function it could aim at resolved the
root itself. The remedy both times was the same, and it is a design rule rather
than a habit — **a function a test needs to steer takes the root, or the project,
as an argument**. `snapshot_project` resolves the anchor and hands it to
`select_project`, which does the census work; the test builds its own two-project
census in a temp directory and selects against that. A test that can only call
the resolving half is a test that can only be green at home.

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
