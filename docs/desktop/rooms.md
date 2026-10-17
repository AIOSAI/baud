# Rooms, the terminal, the workbench and the bell

This page covers where an agent's session lives and how the desktop reaches it: tmux rooms and the seat model, the terminal, the workbench tabs beside it, and the bell.

← [the desktop window](../desktop.md)

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

**An ended room stays dead.** Nothing in BAUD
reopens it: not the next poll, not a hot reload, not the next app launch. The
one door back is the operator opening that card again — a click on `attach`,
`resume` or `fresh` clears the mark and the branch behaves normally from then
on. The mark is local intent (`localStorage`, keyed per project and branch),
recorded only after tmux confirms the kill: a room that refused to die is still
alive, and BAUD says so instead of pretending. The startup agent reads the
same mark — see *Startup agent* in [settings](settings.md#the-header-gear--bauds-own-interface).

**Sessions BAUD did not create.** A branch whose own room is absent — or exists
but holds no claude (a room holding no claude never outranks a live seat; the
row's `own_room_live` says which) — can still hold a live agent: @hooks' boot shim seats a typed `claude` in `aipass-<branch>`,
the Telegram fleet wakes agents in `telegram-<branch>`. The snapshot reads panes,
not just session names, so those show up as the branch's `outside_room` and the
card's doors act on them: the badge wears a `⧉` and names the session on hover,
the launch door reads `▸ attach` (never a second claude in a branch that already
has one), and `✕ end room` ends that session rather than a `baud-<branch>`
that does not exist.

A session is a candidate only when tmux reports one of its panes running
`claude` with its working directory inside the branch. The narrowness is the
point: a looser test would let BAUD adopt the operator's own tmux window and
type a claude command line into it. A claude install that reports some other
pane command simply never matches, and the card treats the branch as having
no outside session. BAUD CREATES only its own `baud-` rooms, and an existing
`baud-<branch>` always wins over an outside session.

**The row names its own room.** Every snapshot row carries `room` —
`baud-<branch>` in the anchor, `baud-<project>-<branch>` elsewhere, sanitized for
tmux targets — spelled whether or not that session exists, because the name a
live room *has* and the name a launch would *create* are one string. With
`has_room`, `own_room_live` and `outside_room` beside it the row states the whole
resolution: own room while a claude is in it, else the outside session, else the
own room if it merely exists, else this name to create. The doors resolve
through the same rule (`RoomScan::door_session`).

The name is published so that no other runtime re-derives it. A naming rule
living in two runtimes (say, @api's attach lane in python) disagrees with itself
the first time either side changes one, landing not as an error but as
*attached to a session that never existed*. BAUD names its own rooms, so BAUD
says the name. It costs nothing to carry: the snapshot already builds that
string to answer `has_room`.

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

The question is asked of **the session, not the seat**, so the chips appear in
a room attached from another project, which the seat's cards know nothing
about. The snapshot carries `live_agent_sessions`, every tmux session on the machine holding a live
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
object per line (`ts`, `kind`, `title`, `body`, `source`). There are no desktop
toasts: ai_mail's notifier writes this feed and has no D-Bus or notify-send
path.

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
