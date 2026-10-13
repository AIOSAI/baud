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
binary, not installers. Last built 2026-08-12 18:52, current through m12 —
rebuilt with the room-end fixes, because the launcher's binary is what the
operator actually opens tomorrow. The desktop launcher
(`~/.local/share/applications/baud.desktop`) execs this binary directly, so a
rebuild IS the deploy; its `Path=` seats the process inside the AIPass tree,
which is how the release app's ancestor-walk finds its anchor.

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
because that is what a card reads: the branch's passport, not its process. The
name is now literal on both counts — a card's avatar **opens** the passport as
a document (see *The opened passport*), where before the strip only read one.
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

- **Lamp** — amber pulse: dispatched (`.ai_mail.local/.dispatch.lock` names a live pid).
  Steady green: interactive (a live claude with no `-p`/`--print` has its cwd
  inside the branch). Dim: neither.
- **Avatar** — the agent's initials in a disc, and the door to its passport.
  A fleet of seventeen is scanned by shape before it is read by name; the
  phone's wheel had been doing this for weeks and the desk now does it too.
  The avatar rather than the whole card is the door on purpose: a card is
  already a dense field of doors, and a click-anywhere card turns every miss
  into a navigation.
- **★ manager mark** — beside the name, amber, on citizens whose passport says
  `identity.citizen_class` is `manager`: a project's first agent and its owner,
  the only class holding git write, the feedback channel to @devpulse, and
  watchdog. It sits with the name rather than the badges because class is what
  an agent *is*, where the badges say what it is *doing*. One per project by
  construction, so the mark stays rare and the hover does the teaching. Read
  from the passport itself — no passport, unreadable, malformed, or any other
  class all read as "not a manager", because an ownership mark is a claim BAUD
  only makes when the file makes it. **The avatar carries the same fact in
  colour**: a manager's disc is ringed blue — Patrick's ruling, explicitly not
  red, because red is this app's alarm colour and ownership is not an alarm.
  The card now carries the class twice, once in a glyph and once in a colour,
  which is deliberate: the glyph is precise, the colour is what survives a
  glance across seventeen cards. The snapshot carries `citizen_class`
  verbatim beside the boolean, so a class AIPass adds later needs no new
  plumbing to reach the passport page.
- **Badge** — `dispatched`, `live`, or a quiet `room` when a tmux room exists
  with nothing live in it. A trailing `⧉` means the live session is one BAUD
  did not create; hovering names it.
- **Sub badge** — amber `N sub` while sub-agents are running inside the branch's
  session, and **the avatar pulses red** for the same fact: the disc fills and
  its initials invert, roughly once a second. The badge counts; the pulse is
  what carries across a room. Red here where the manager ring is blue, because
  this one *is* activity worth a glance — work happening inside a session that
  nothing else on screen reports.
  The pulse animates the disc's fill rather than a halo around it, and that is
  a correction worth recording: the first version borrowed the dispatched
  lamp's glow-only idiom and Patrick read it as "no flash just a solid red".
  The animation was running the whole time and was simply invisible — a 9px
  lamp *is* its glow, but a 26px disc whose border and initials are already
  solid red drowns a 35%-alpha halo. Under `prefers-reduced-motion` the fill is
  held rather than pulsed: motion off, state kept, and kept in a form that can
  still be read.
  Sub-agents never appear in the process table (they run inside the
  parent claude), so the count comes off disk: async agents by the freshness of
  their own `subagents/agent-<id>.jsonl` (180-second window), blocking agents by
  `Agent`/`Task` spawn calls with no matching result in the transcript tail.
  Only transcripts written in the last 15 minutes are consulted. That freshness
  window is why a finished agent can hold the count up for a few minutes — the
  number is honest about what the files say, not about what is still breathing.
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

## The opened passport

Pressing a card's avatar opens that agent as a **document**: issuer, document
type, holder — `AIPASS`, `AGENT PASSPORT`, the name — then the pages. It is a
modal rather than a workbench tab, and the distinction is the reasoning: the
workbench is where the operator *works*, holding a terminal and the files kept
open beside it, while a passport is consulted and dismissed. Escape closes it,
because the settings panels already taught that gesture.

**Identity** renders `.trinity/passport.json` as fields, never as the JSON it
happens to be stored in: class, role, purpose, traits, with `created` shown as
*Issued* and `registry_id` as the *passport number*. **Working memory** is four
tabs over the agent's own files — Sessions, Key Learnings, Todos from
`local.json`, Observations from `observations.json` — each entry a card with its
number, date and text. They are ordered newest-first *by position, not by date*:
these files are appended to, so a hand-typed date can be wrong in a way the
order cannot. The four containers disagree about what they call their text
(`summary`, `learning`, `note`, `task`), so one reader tries each name and an
entry carrying none of them says so rather than rendering blank. A footer says
what the page is: the recent end only, because the rest has rolled over into
@memory's archive.

**Sub-agents appear as a count and only ever a count** — no names exist in that
lane and BAUD will not imply any.

**A manager's passport carries the two global monitors** — prax mission control
and the commons feed. They used to sit in the top bar, which had no room for
them, and they belong to the agent that runs them. Same doors and the same tab
ids as before, so a monitor opened from a passport *is* the tab the old bar
opened, and closing it from the tab bar leaves the toggle honest.

Every page is read and nothing is owned: these are @spawn's and the agent's own
files, and a read that fails prints the refusal in the file's own words rather
than drawing an empty document that would read as an agent with nothing to say.
A passport reached from another project's roster card is fenced like every other
read and says so.

**The document follows the poll.** Its row is looked up live on every render
from the seated snapshot, falling back to the roster sweep, and matched on name
*and* project — a room name carries its project scope, and eleven projects share
a naming convention. The click-time snapshot is kept only for a branch that
leaves both lists mid-read. This was a defect first: the first version froze the
whole card at click, so a card could flash red for four running sub-agents while
the passport opened from it still read "none running". A view that shows live
numbers has to read them live.

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

**Sessions BAUD did not create.** A branch whose own room is absent — or exists
but holds no claude (ruled B, 2026-09-07: a room holding no claude never outranks
a live seat; the row's `own_room_live` says which) — can still hold a live agent: @hooks' boot shim seats a typed `claude` in `aipass-<branch>`,
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

**The row names its own room** (2026-08-18). Every snapshot row carries `room` —
`baud-<branch>` in the anchor, `baud-<project>-<branch>` elsewhere, sanitized for
tmux targets — spelled whether or not that session exists, because the name a
live room *has* and the name a launch would *create* are one string. With
`has_room`, `own_room_live` and `outside_room` beside it the row states the whole
resolution: own room while a claude is in it, else the outside session, else the
own room if it merely exists, else this name to create. Until ruled B
(2026-09-07) the own room won whenever it *existed*, and an empty `baud-` room hid
a live seat from both faces — and from the doors, which resolve through the same
rule (`RoomScan::door_session`).

It is published because the derivation had been *copied*. @api's attach lane had
re-implemented the prefix, the scope rule and the character sanitizer in python
to work out which session to attach a phone to, and a naming rule living in two
runtimes disagrees with itself the first time either side changes one — landing
not as an error but as *attached to a session that never existed*. BAUD names its
own rooms, so BAUD says the name. It costs nothing to carry: the snapshot already
built that string to answer `has_room`, and now it answers with it.

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
read is never the safer choice.

**That was the doctrine and not the code until 2026-08-18**, and the gap is
worth recording because it was invisible from every direction. `read_object`
answered `{}` on *every* read error, not just a missing file — a permission bit,
a mount that went away, a directory in the file's place. The chain that follows
is silent all the way down: the gear reads blank, every dial renders at *unset*,
and the next save writes a fresh three-key document over an operator's
permission rules with nothing anywhere to report. @seedgo found it by
cross-reading this module against @api's python mirror, which had been hardened
against exactly this case and never told this side. The split is now by error
kind — `NotFound` reads blank (a fresh branch is not a fault), **everything else
refuses**, so the write that would have followed never happens. Two tests hold
it: an unreadable file must not read as `{}`, and a patch over one leaves the
file byte-for-byte as it was.

One divergence from the python mirror survives on purpose and is reported rather
than papered over: python also reads *not-a-directory* as blank, and
`io::ErrorKind::NotADirectory` needs Rust 1.83 where this crate's MSRV is
1.77.2. That case refuses here instead, which is the safe direction to be wrong
in, and it is on the conformance list rather than hidden. Writes land through a temp file in the same
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
it was not asked to.

**The memory row is live now**, and it is the only row in this gear that does
not touch claude's settings file — which is why it commits on its own, on blur,
instead of riding the panel's save button. One button writing both would make a
model change quietly rewrite this agent's memory. It lists the keep-counts, how
many entries of each type survive a rollover, and each dial goes through
`drone @memory config set <branch>` — the same verb a human would type — then
re-reads the file, because @memory's refusals exit zero and only the read-back
proves a number moved.

Each dial says which number it is showing: **override · fleet default 20**, or
just **default**, so nobody edits a shared number thinking it is theirs or the
reverse. The timing is stated on the row — *applies at the next rollover run* —
and one edge is written into the code rather than hidden: @memory resolves
per file KEY, so a branch carrying a *partial* group block could be shown a
default here that the engine would not apply. It cannot happen today, and the
real fix is a resolved read from @memory rather than BAUD re-deriving the rule.

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

A **memory** section of its own — the desktop gear's second tab, and the phone's
`settings → memory` row — reads
`<AIPass root>/src/aipass/memory/memory_json/custom_config/memory.config.json`
— @memory's file, shared by every citizen in the ecosystem. It carries its own
save button, deliberately: one button writing two owners' config is how a
poll-cadence tweak ends up silently rewriting the fleet's memory limits.

**It used to sit at the bottom of the interface panel and no longer does.**
"Interface" is this face's look and feel; these dials are another agent's
fleet-wide config, and one door cannot honestly be labelled for both (Patrick's
ruling). Same component on both faces, one implementation, two placements.

| Half | What it sets | Written by | When it takes effect |
| --- | --- | --- | --- |
| entry caps | `entry_limits.entry_types.<type>.max_chars` — chars per entry | BAUD, directly (no verb exists) | immediately; the enforcement hook re-reads the file on every memory write |
| keep-counts | `rollover.defaults.<group>.<container>.count` | `drone @memory config set-default` | at the next rollover run, and only for branches after a push |

**The two halves travel different lanes, and that split is the rule.** Every
keep-count now goes through @memory's own verbs rather than BAUD editing the
file, so the bounds (1–100) and the refusal wording live in one place instead of
being re-implemented here and drifting the first time @memory changes them. Only
the character caps stay on the direct write, because they have no verb behind
them yet. `auto_compact_cap` is displayed and **not** editable — it is read-only
in v1, and an input that silently does nothing is worse than no input at all.

**The panel now runs the push itself**, behind a two-tap confirm, and its copy
carries @memory's real semantics unsoftened: changing a default does *not* reach
any agent, and until you push, every agent carrying an override keeps reporting
its old number. When no branch overrides exist the panel says so in a sentence —
*every agent is at the defaults* — rather than showing an empty region, which
reads as a list that failed to load. **Per-agent limits are editable from the
card gear**, each dial committing on blur through the same verb.

Nothing promises a schedule, because there is none: there is no daemon tick, and
a changed limit is applied by the next rollover *run* — a compaction hook, a
watch, or somebody running it by hand. Nothing is hardcoded either: the caps, the
dials and the branch list are whatever the file says today, and an entry type
@memory adds tomorrow simply appears.

**A refused write exits zero.** `drone @memory config set` prints its refusal and
returns success, so nothing in this lane trusts an exit code: the wrapper looks
for @memory's own marker, passes their sentence through unreworded, and re-reads
the file afterwards — the read-back is the proof a number moved, never a string
BAUD parsed. The phone meets the same hazard in a different costume, where @api
forwards an after-routing refusal as HTTP 200 with `ok: false`, and its transport
throws on that. (Pre-routing validation failures *do* arrive as a 400.)

Two refusals guard the direct lane, both stricter than the card gear's. A dial
that does not already exist on disk is **not created** — BAUD turns dials it can
see, and inventing structure in another agent's config is the cross-edit the
ecosystem forbids. And zero is refused: it is the one value that reads as a
valid number and silently breaks every memory write in the fleet. Both refusals
happen before a byte is written. The keep-counts inherit the equivalent refusal
from @memory itself now that they travel the verb, which is the point of moving
them — one owner, one bound, one sentence.

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

## The command surface

`invoke_handler` in `app/src-tauri/src/lib.rs` is the canonical inventory —
29 commands, and nothing reaches the backend that is not on this list:

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
```

The registry stayed in `lib.rs` when the command functions moved into lanes
beside it (2026-08-18). That was deliberate: one list of what a face may invoke
is worth more than tidiness about which file the list sits in.

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
│   │   │                       transport.ts = tauri IPC · transport.http.ts = /v1 over fetch
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
entry point reached as `drone @baud`, with `apps/modules/` and `apps/handlers/`
still empty. `BAUD_REGISTRY.json` names `src/baud/baud` as its one branch, which
makes `src/baud` this project's fleet directory — seat BAUD in the BAUD project
and you get exactly one card.

**`tests/` holds no tests.** Its README used to promise a framework layout that
never arrived; it now names where the tests actually are. The Rust tests live in
`app/src-tauri/src/`, in `#[cfg(test)]` modules beside the code they test. The
frontend's tests are vitest files beside the modules they pin (`*.test.ts` under
`app/src/`), pure functions only, run by `npm test` alongside `tsc --noEmit` and
the two bundle builds. There is no Python surface. A signpost that points
somewhere beats a directory that only looks like a suite.

**`CLAUDE.md` and `AGENTS.md`** carry the same startup protocol for the agent
working in this directory (read `.trinity/`, use drone, keep memories current);
they are agent instructions, not documentation of the app.
