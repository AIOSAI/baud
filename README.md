# BAUD

BAUD is the AIPass desktop: one window that holds the whole citizen fleet and
puts every agent one click away. It is a Tauri 2 application — a Rust backend
in `app/src-tauri/`, a React + TypeScript frontend in `app/src/` — and Linux is
the platform it actually works on (the activity scan reads `/proc`, the camera
button speaks XDG portal; on other targets those two degrade to "nothing
running" and an honest error).

**Looking for where something lives rather than why it works? Read
[MAP.md](MAP.md) first** — every piece of this repo in one screen of
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

The binary has a second entry point, and a headless twin, `baud-cli` (below).
Each headless flag prints one JSON object on stdout and exits, opening no window
and touching no tauri state:

```
baud --snapshot      [--project <name>]
baud --list-projects
baud --roster
baud --end-room      <branch> [--project <name>]
baud --capture-room  <branch> [--project <name>] [--lines <N>]
baud --send-room     <branch> [--project <name>] (--text <literal> | --key <NAME>)
```

One verb per process. Writing both is a usage error rather than a precedence
rule — a caller who asked for a read *and* a kill does not know what they asked
for, and guessing for them is how a read turns into a kill.

It exists so that **"which agents are alive" has exactly one implementation.**
The phone arc puts a host API in front of the same fleet (DPLAN-0300), and the
alternative was a second room-judgment written in Python — which would drift
from this one, and on the day it drifted neither answer could be trusted. One
reader rather than a separate `baud-snapshot` tool, for the same reason a step
further out: a second implementation is a second version that can silently
disagree with the GUI. `baud-cli` is a second binary but not a second reader —
the same crate, the same `run_headless`, cut from the same tag.

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

### `baud-cli` — the same doors, with no desktop

The desktop `baud` links the whole GUI stack even to print a snapshot — 129
shared objects, webkit2gtk and GTK 3 among them — so a server or a container
with no desktop could not start it, and a fresh install's phone showed *The baud
binary was not found* over an empty fleet. Patrick chose to fix the shape rather
than write a Python re-reader (2026-09-14, FPLAN-0589): `baud-cli` is a second
binary target in the same crate, `src-tauri/src/bin/baud_cli.rs`, which hands its
arguments to `run_headless` and exits with its code.

- **The six verbs answer exactly as above**: same arguments, same stdout, same
  exit codes. `baud` keeps answering them too. Error lines on stderr carry the
  name the process was started as, `baud:` or `baud-cli:`.
- **It never opens a window.** With no verb, or none of the six, it prints the
  six to stderr and exits `2` with stdout empty.
- **It is built with the `gui` feature off**, which is what keeps GTK out:
  `cargo build --release --locked --no-default-features --bin baud-cli`. `gui`
  is on by default, so `npm run tauri dev`, `npm run tauri build` and
  `cargo test` build what they always built; it gates tauri, the opener plugin,
  the terminal, the screenshot portal and every `#[tauri::command]` wrapper. The
  lanes only the window uses (`memory`, `notifications`, `pty`, `reads`,
  `screenshot`, `settings`) build only with it. Give `baud-cli` its own cargo
  invocation: built beside the app, feature unification switches `gui` back on.
- **It links libc, libgcc_s and the loader, and nothing else** — about 520 KB.
  CI builds it and fails if `ldd` names libgtk, libwebkit, libjavascriptcore or
  libsoup. A bare `ubuntu:24.04` container with no packages added runs it:
  `--roster` exits `0` inside a tree with `src/aipass`, and outside any tree
  exits `1` with the envelope saying so.
- **The host API prefers it.** @api resolves the binary per request, in the
  order FPLAN-0589 pins: its `baud_bin` setting, then
  `~/.aipass/baud/bin/baud-cli` (where `aipass baud install` lands it), then
  this checkout's `target/release/baud-cli`, then `target/release/baud`, then
  `baud-cli` and `baud` on `PATH`. That resolution is @api's code; this repo
  ships the binary.
- **Releases carry it** as `baud-cli-v<version>-linux-x86_64`, beside the
  desktop binary, with its sha256 in the same `SHA256SUMS.txt`.

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
│   └── README.md               a pointer at this file and MAP.md, and nothing else
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
└── README.md                   this file
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

## Development

Stack: Tauri 2 with `portable-pty` and `ashpd` on the Rust side; React 19,
xterm.js and CodeMirror 6 on the frontend; one plain stylesheet. BAUD's own
markup carries no inline styles — zero `style=` attributes across the entire
frontend, every colour read out of `theme.css`.

The CSP is not what enforces that, and the difference is worth one paragraph:
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`.
`script-src` stays `'self'` with no exception — no inline scripts, no CDN, no
remote origin. `style-src` carries `'unsafe-inline'` for exactly one dependency:
xterm.js styles its own DOM at runtime (row metrics, cursor, theme) through inline
attributes and an injected `<style>` element, and without the exception the
terminal renders unusable. So the absence of inline styles in BAUD's markup is a
discipline the codebase keeps, not a wall the browser holds for it.

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

### The phone face — a wheel of agents, read by default

`npm run build:phone` emits `dist-phone/`: BAUD as a wheel of agents, installable
to a phone home screen, built from **the same React components** as the desktop.
(It was a single column until FPLAN-0423 — see *The wheel* below.)

The entire port is one alias in `vite.config.phone.ts`. `host/index.ts` imports
`./transport`; that build resolves it to `transport.http.ts` — `fetch` against
@api's host API — instead of the tauri binding. The typed verbs, the cards,
the bell and the palette are compiled unchanged. The proof is mechanical: the
phone bundle contains **zero** occurrences of `@tauri-apps`, and the `/v1`
routes it does contain came from the transport table alone — plus two doors that
are not table rows because they are not JSON request/response: the room socket
(`/v1/room/attach`) and the multipart upload (`/v1/files/upload`).

The counts move as the seam grows, so they are stated as measured rather than
carried forward: `host/index.ts` exports **40** typed verbs today (it was 26 when
this section was written), the http table holds **29** rows across **23**
distinct routes, and the built bundle contains **25** — those 23 plus the socket
and the upload. Re-measure rather than trust the sentence: the numbers are here
to be checked, not believed. Last measured 2026-08-18, after the roots door.

**The refusal table now points both ways.** `transport.http.ts` has always
refused the verbs a phone cannot perform *by name*; since DPLAN-0303
`transport.ts` carries the mirror image, `NOT_ON_THIS_FACE` — the git app's five
reads have no Rust command behind them and should not have one, because the desk
sits three feet from the repository with the operator's own git in a terminal.
Without the table those names would reach `invoke` and come back as tauri's
*command not found*, which reads as a broken build rather than as a face that
was never meant to have them. It is deliberately **not** retro-fitted to the
older phone-only verbs: new names, new rule, and the old ones move when somebody
has a reason to move them.

The seam is command-shaped and `/v1` is REST-shaped, so `transport.http.ts` holds
a table from command name to route, and holds it alone. Verbs the phone cannot
perform are refused **by name** with a reason (`pty_create` → "the phone has no
pty") rather than silently failing — a designed absence and a bug should not look
the same from a phone.

**No token is ever baked into the bundle.** The face opens on a paste-token
screen, proves the token against `/v1/whoami` before showing anything, and keeps
it in `localStorage`. A refused token and an unreachable server are reported as
different failures, because they send the operator to different places.

*A read token stopped being a harmless mirror on 2026-08-18.* It still refuses
every verb by name — but since the file lane learned a `home` root, it also
reads whatever a person can read on that machine, private keys included. The
ruling and the full exposure are recorded under* **The FILES app** *below; this
note is here so the claim is not read as still-true from the top of the page.*

**Browsing is free, and the seat is a default rather than a fence.** Patrick's
ruling, 2026-08-16: view any agent's project files, open any passport, no
restriction. `/v1/files`, `/v1/dir` and `/v1/diff` take a `project` and resolve
it through BAUD's own census, exactly as `/v1/fleet` always did — an unknown
branch inside a known project is a 400 naming both, an unknown project is a 503
carrying BAUD's own census sentence, and the per-branch path fence is untouched:
browsing is free across *branches*, never across the disk.

This closed a real asymmetry rather than adding a feature. For one evening the
fleet lane honoured `?project=` while the read lanes were seated in whichever
project the server started in, so the header could be switched to a project
whose cards all appeared and whose every file read then refused — README, inbox,
dashboard, working memory, the passport. It was found by probing the live host
with controls (project omitted and the seated name both succeeded; two other
project names both failed on both routes) and fixed server-side the same night.

**So the phone names the project on every read.** Omitting it is not a smaller
request, it is a *different* one: eleven projects share a naming convention, so
a read aimed at a foreign agent and resolved under the seat does not fail —
it finds a same-named local agent's file and shows it as this one's. The three
read verbs in the seam take an optional project and leave the key off the
payload entirely when there is none, so the desktop — which resolves under the
seat it already sits in — hands `invoke` a byte-identical object to what it did
before the argument existed.

**Reads are not verbs.** The first cut got this wrong — every card callback was
wired to a handler that threw, so the face showed all seventeen agents and did
nothing at all. Opening a file and reading a diff were never verbs; they are
exactly what the read lane serves. Each card now carries a read row (diff,
readme, memory, dashboard, inbox) that opens a full-height reader, and the
card's own figures open the file they came from. A `feed` screen replaces the
desktop's drop-down shade: same events, cursor-keyed, and when the server
reports a `gap` the screen says so — a window that silently lost events looks
exactly like a quiet night, and those are opposite things.

**The `GIT` tile is live, and it has three answers rather than a number with a
fallback.** The count was the last figure on the card with no route behind it;
it now rides `/v1/git-changes`, which matched the desktop's *semantics* and not
just its shape — tracked files only, branch-local paths, `git diff HEAD`
relative — so the two faces cannot disagree about the same branch at the same
moment. The response also carries `untracked`, and the phone **deliberately drops
it**: rendering it would make the phone's tile mean something the desktop's does
not, which is the exact divergence the matched semantics exist to prevent. It
belongs on both faces or neither, and the desktop is frozen.

**The tile's number still drops untracked; the screens behind it do not** —
which is not a contradiction, because they are answering different questions.
The tile is the desktop's figure and stays matched to it. Since 2026-08-17 the
tile is also a *door*: it opens the changes screen described below, and that
screen asks the same route for the whole envelope — git's own two-column codes,
untracked files **by name** — because a list of what changed that silently omits
the new files is a list nobody can act on. A count that means one thing and a
list that shows more is honest as long as both say which question they answered.

The three answers are the point. `0` is a **fact** — it says nothing has changed
in this branch — so a lane that cannot answer must not be able to produce it.
A refusal renders `n/a`, which cannot be read as a number, and carries the
server's own sentence with it; the em dash stays for *asking* and for a branch
with no git at all, which are absences rather than failures. An empty list
painted as clean is the one lie a glance would read as truth and act on.

**And the tile refuses for real reasons, not for being far away** — which took a
probe to establish, because the brief said otherwise. The expectation handed to
me was that *every* foreign project would answer `503`, drone having no passport
to verify its caller with. Measured against the live server with controls in both
directions, that is not what happens: `VERA-STUDIO`, `EARMARK`, `AIPASS-SITE`,
`MARKETSTAND` and `BAUD` all answer `200` with real data, and the one `503` in
the sweep was `CHESS` saying *"fatal: not a git repository"* — a true statement
about that project rather than a fence. The control that settles it is this
branch: the API reports `count 0, untracked 3` for `baud`, and this branch's own
tree is exactly that — three untracked directories, no tracked changes. Had the
tile been keyed on *foreignness* it would have painted five projects' correct
counts as unavailable, which is the same lie told in the other direction.

**And the bell counts while that screen is shut**, which is the only stretch a
badge is for. The feed screen polls its own cursor lane, but it mounts on open
and unmounts on close — so nothing was counting during the entire period the
number describes, and the bell was a bare glyph with no state at all. *(The
badge's own lane took the cursor too on 2026-08-18 — see* **Nothing polls a
pocket** *below; when this was written it refetched the whole window.)* The count
now lives a level up, on the desktop `Bell`'s model: poll the feed, hold a marker
for how far the operator has read, badge the difference, key the marker per
project because another project's feed is another history. It diverges from the
desk in one deliberate place. The desktop's shade is a glance with a `CLEAR`
button beside it; the phone's feed is a full-height screen you must leave to get
back to anything, so **leaving is the read** — the marker moves on close, never
on open, so nothing can be marked read while it is still arriving behind the
screen you are looking at.

**The name in the header is the refresh** *(Patrick, 2026-08-19: browser and OS
gestures fight him for that gesture, so refreshing meant reaching for browser
chrome every time)*. Tapping `BAUD` flashes it amber for 200ms and then does a
full `location.reload()` — the same thing his browser refresh does, deliberately,
because that is the gesture being replaced. It is lossless for the reason he
already refreshes freely: nothing this face knows lives only in this face. The
seat is in `localStorage`, every room is a tmux session on the host, and the
fleet is one poll away. So there is no confirm, no double-tap, and no ceremony.

The 200ms is not a delay, it is the acknowledgement. A tap that shows nothing
until the page comes back reads as a dead button on a slow reconnect, and the
operator's next move is to tap it again. `:active` paints amber while the finger
is still down — instant, and it costs no render — and the flash holds through the
reload.

**And the name wears the wordmark's green** *(Patrick, same day, after thumb-
testing it: "it was green before now its white. I liked the green")*. It drinks
`--baud-green` and a glow at the desktop wordmark's own ratio — 0.6em of the type
size, so 8px around 13.6px of text rather than the desk's 12px around 20px, which
at this size would be a smudge. One identity in two sizes. The tap still answers
amber, halo included, because amber on green is a state change you cannot miss
and amber on pale was one you could.

**Where the green had gone is worth more than the green.** It had never been
there: `.baud-phone-title` resolves to `--baud-ink` in *every* committed state of
this face, from the commit it was born in to the one before this round, and
turning the span into a button did not change it — measured at
`rgb(214, 226, 220)` both ways. But the phone CSS bundle can only ever have been
one of four builds, one per commit that touched a stylesheet, and **the host's
own access log names three bundles it has served — and two of them match no
commit at all.** The bundler never moved in that window (the single dependency
change since the face landed added a library), and the third bundle reproduces
byte-for-byte today, so the mismatch is content and not tooling.

So `rebuild-is-deploy` has twice served a phone face that was never committed,
and it reverted silently the next time anyone built from a clean tree. That is
the hole, named rather than shamed: the served-bytes check this repo already runs
proves *tree matches serve*, which is not the same claim as *git matches serve*.
The bundles themselves are unrecoverable — `emptyOutDir` wipes `dist-phone` on
every build — so whether one of them carried a green name cannot be proven. It is
the only window in which it could have existed, which makes his memory the most
likely honest witness in the room.

**Only the hit area grew.** The word is a `<button>` now and its position and
size are unchanged to two decimal places: `x 12.00, y 6.14, 37.09 × 16.00` before
and after, header height `31.00` both, measured in a headless browser against a
control styled the way the span was. The thumb target is a pseudo-element, so the
layout never learns about it: it reaches the screen's own left edge, up through
the notch inset, down to the header's bottom edge, and right by 10 of the 14
pixels of gap — leaving four pixels of dead space that always belong to nobody.
That is **60 × 30** on a 360px face, plus whatever the safe-area inset adds when
it is installed. It deliberately stops at the header's bottom edge: an overhang
there would take taps from the wheel, and a refresh that eats a card tap is a
worse bug than a target 14 pixels short of the 44px guideline. Going the rest of
the way would cost either the header height Patrick fought for (*"probs 3
space"*) or those wheel taps, so it is his ruling, not mine.

**Three verbs, and refusal is a state rather than an absence.** The phone can
now *wake* an agent, *end a room* and *lock the machine's screen* — chips under
each card, plus one lock chip in the header, because there is one machine. Under
a read-scoped token every chip is **still there**, dimmed, carrying the sentence
that says why it will not fire; hiding them would make a designed absence look
exactly like a broken build. Patrick's own phone token stays read-scoped, so
that dimmed state is the everyday one, not an error path.

**The header lock chip reads the lock, too** (FPLAN-0585, 2026-09-13). Away from
home, a glance should answer *did I lock the laptop?* — so the chip polls
`GET /v1/lock` (@skills' `lock_state()`, relayed verbatim by @api, read scope)
every 5 s while the app is looked at, re-reads at once and again a second after a
tap because the lock lands async, and forgets the reading when the app goes away.
An OPEN shackle in green is unlocked. The closed shackle in amber is locked —
attention, not failure, since red on this face means dead or refused. The closed
shackle, dim and with a dashed border, is *unknown*: the machine could not tell,
or the read failed, and the title carries the reason. Unknown is never drawn as
unlocked. Before the first answer the chip is exactly what it was, and because the
read rides the read scope, a read-scoped token sees the lock's position even
though its tap is refused.

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

**Links and copy out of a room** (FPLAN-0641, 2026-10-12). A login prints an
OAuth URL into the room, and on the phone that URL was plain text: no tap opened
it, and nothing lifted it off the screen. Two doors now read one detection,
`app/src/phone/lib/roomLinks.ts`, so the panel can never list a link the tap
cannot see, or the reverse.

- **A tap on a URL opens it.** The sheet registers its own link provider on
  xterm, and the URL opens in a new tab with no opener. A tap while select is
  armed opens nothing, because selection forges mouse events and a drag over a
  URL must not navigate. Only `http(s)` is ever a link.
- **Why not the web-links addon the desktop loads.** The addon joins rows only
  where xterm itself wrapped them. A URL can also arrive *hard*-wrapped, broken
  into lines by a full-screen interface or by tmux repainting a pane, and then
  the addon underlines one row and a tap opens a third of the URL. The join is
  done in `roomLinks.ts` instead, where tests pin it. A hard wrap is read
  narrowly: the URL must reach the right edge, and the next row must be nothing
  but URL characters at the left edge or the line's own indent, so a sentence
  under a URL never joins it.
- **The links panel.** A chain chip in the view column, between select and the
  arrows, scans the whole scrollback once and lists the eight most recent URLs.
  Each row shows the whole URL in a read-only field, with **open** as a real
  link and **copy** beside it. An empty list says how many rows it read. The
  panel is an overlay on the screen, so the belt does not grow, nothing is
  re-fitted, and a live selection is not dropped.
- **A copy says which lane took it**, in one of three notes. A resolved
  clipboard promise is a confirmed copy. An `execCommand` yes is reported as a
  claim, because over plain http it can say yes and copy nothing. A refusal
  says *not copied*. For the last two, the text is shown in a read-only field
  that selects itself on focus, where Android's own long-press Copy is the
  certain route.

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
(`src/phone/lib/push.ts`) are still exported, empty and inert — a reservation with
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
cd app/src-tauri && cargo test      # 101 unit tests; compiling IS the Rust type check
cd app/src-tauri && cargo clippy    # lints
cd app && npx tsc --noEmit          # TypeScript type check
cd app && npm test                  # vitest - the pure derivations, pinned beside their modules
cd app && npm run build             # tsc && vite build - the frontend must actually build
cd app && npm run build:phone       # the phone face - same components, HTTP transport
```

There is no seedgo audit lane for this repo: seedgo's checks target AIPass
Python branches, and BAUD is Rust and TypeScript. The six commands above are
the audit.

`.github/workflows/ci.yml` runs all six as a robot on every push to `main` and
every pull request. `build:phone` joined the frontend job on 2026-09-13
(DPLAN-0343); before that a change that broke only the phone entry passed green.
`npm test` joined the same evening, after the type check and before the builds.
Since 2026-09-14 the `rust` job also builds `baud-cli` with the `gui` feature off
and fails if `ldd` shows it linking a GUI library (FPLAN-0589). After touching the
feature gate, run `cargo test` and `cargo clippy` with `--no-default-features` as
well: 58 tests need no window, and all 101 run with `gui` on.
Two parallel jobs (`frontend`, `rust`) on a
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

### The wheel — the fleet as one flick

The fleet screen is a horizontal rail. Cards scroll-snap sideways, scale from
1.28 at the centre to 0.90 at the edges with an opacity fade, and a green notch
under the middle names the centre as a **place**. Whoever sits under the notch is
the **current agent**, and everything context-bound follows them.

**The column was not wrong, it did not scale.** Seventeen agents in a vertical
list is a scroll-to-find, and the fleet's whole point is knowing at a glance who
is awake. The rail makes the entire fleet one flick, and it gives the phone
something the desktop does not have: a current agent at all.

**Patrick approved the shape off a live mockup on his S24, in one round.** That
makes `dropbox/wheel_round/wheel_mockup_APPROVED_SHAPE.html` the specification
rather than a suggestion, so its numbers — 76px cards, 52px avatars, the 1.28
scale, the `.12s linear` transition — were ported literally. Only its hard-coded
hex colours were changed, into `--baud-*` tokens, so the rail follows the theme
instead of freezing one night's palette into a second source of truth. **An
approved shape spends someone else's decision; improving it silently is not a
style choice.**

**Two gestures, and only one of them can launch anything.** A tap on an
off-centre card glides it under the notch and opens *nothing*. Only a tap on the
card that is already centred opens it. Every launch therefore costs two
deliberate touches, and a thumb reaching across a rail of seventeen cannot start
a session by accident.

**The scroll is the browser's, deliberately.** `scroll-snap-type: x mandatory`
plus native overflow scrolling — momentum, snap physics and accessibility all
come free and all feel wrong reimplemented. The code only *paints* the
consequence of a scroll position, imperatively, one frame at a time; seventeen
React re-renders per frame of a flick would lose the feel that was approved.
State is lifted only when the centred card actually changes.

**The rail's gestures cannot leak into the room's.** `touch-action: pan-x` hands
the browser the horizontal flick and refuses the vertical one in the same
declaration; `overscroll-behavior-x: contain` stops an overscrolled flick
becoming browser back-navigation — the same species as the pull-to-refresh that
ate the down-swipe last round. The terminal's own guards are untouched.

**One layout — and this part was wrong for a day.** The approved mockup hid the
rail whenever a room was open, and that was *my* design call inside the shape.
Live use killed it in a day. Patrick, verbatim: *"the wheel was supposed to be on
top and the terminal below, so I can observe and look at other agents as the
terminal is running in view. I have to detach every time I want to observe
agents. the terminal is the center piece, always there just like desktop, I can
navigate as agents are working."*

So the rail **persists above the terminal at all times**. Fleet view and room
view are not two layouts; they are one layout whose lower region shows either the
attached room or a resting state. The shape was approved and still wrong, and the
same thumb that approved it revoked it — which is the correct order, and the
reason a mockup is evidence about a design rather than proof of one.

**Browsing is not switching.** Flicking the rail moves the notch, the current
strip and the expand target, and touches nothing else: no socket opens, none
closes, no byte is written. The room below keeps running and keeps rendering
while the operator reads across the fleet. Measured negatively, on the wire — a
flick past four cards produces zero attaches, zero detaches and zero client
bytes. When the notch and the terminal point at different agents the face says so
outright (*"the room below stays attached to X"*), because an unexplained
mismatch reads as a flick that failed to switch.

**Switching is one explicit act, and it happens in place.** Attaching from an
expanded card unmounts the old sheet — whose cleanup closes that socket, which
tmux reads as a detach, so the room survives — and mounts a new one against the
new room. The rail does not move: measured at 410px scroll before the press and
410px after. This mirrors the desk, where clicking another agent's room switches
the tab and the cards stay put.

**`‹ detach` is named for what it does.** With the fleet permanently on screen
there is no "back" to go to, so the only thing that affordance does is close this
client. tmux keeps the session, the agent and the scrollback.

**Reads are overlays, and under a persistent rail that stopped being cosmetic.**
The reader and the feed used to be early returns, which unmounted the whole face.
Opening a README while attached would have torn down the terminal and closed the
room's socket — making *"observing never requires detaching"* false through the
door the operator uses most. They render on top now; the room below keeps taking
bytes.

**The keyboard is the one place the layout gives.** A rail, a room, the chips and
a soft keyboard do not fit. The terminal is the centrepiece and is what the
typing is aimed at, so the rail *compacts* while the compose field has focus —
avatars shrink, names and notch drop, the strip and footer go — and never
disappears. Card **width** is deliberately untouched, so the snap geometry cannot
move: measured across focus and blur, card layout width 76px, rail scrollWidth
910px and scrollLeft 410px are identical, and the centred card does not drift out
from under the thumb.

**Deleting a container deletes every door inside it.** Removing the column took
its read row (`readme`, `memory`, `dashboard`, `inbox`) with it. Three landed on
the expanded card's stat tiles, which are **doors, not labels** — on the desktop
those same figures already are the read affordance. `readme` had nowhere to go,
so the agent's **name** is now its README door. This was found by asking what the
deleted element had been carrying, which is a question worth asking *before* the
deletion rather than after.

One thing on the expanded card is a deliberate deviation from the approved
shape, flagged rather than smuggled: the verb chips stay, because dropping the
row would take `end room` with it and strand rooms with no way to close them
from a pocket. `files` and `watch` used to sit beside it as a second deviation —
present but disabled, because they wanted a file manager and a native window *on
the machine itself*. Both went live in August: `files` browses the branch
through the same fenced read lane the stat tiles use, and `watch` streams
@api's read-only `drone @prax monitor run` instead of opening a window on the
desk. Every door on that row is real now, and the disabled-with-a-reason list
retired empty.

**The terminal is one seat, and it goes where it is pointed.** Patrick's ruling,
2026-08-16: *"the terminal is one seat, just a view — it hosts the agent I
choose no matter where I spawn it… I chat with devpulse, go browse baud's files
or run watch, switch to baud, vera, drone — they appear in the ONE terminal…
baud is an aipass tenant, vera is external, that should not matter. When you
block you create friction."* Every door on the expanded card used to refuse a
foreign agent with a single sentence. Exactly one still does:

| Door | Cross-project | |
| --- | --- | --- |
| README, the four stat tiles, `files`, `passport` | **free** | freed when the read routes learned `project` |
| `resume` / `fresh`, `shell`, `wake`, `end room` | **free** | freed by the one-terminal ruling |
| `watch` | **free** | freed by *measurement* — see below |
| `settings` | fenced | its route takes a branch and **no** project |

Each of those retreats is worth keeping, because none of the fences was
arbitrary and each fell to a different kind of evidence.

The **read** fence was guarding something real: while the routes were seated, an
unnamed project resolved under the seat, so a read aimed at a foreign agent could
find a same-named local one and show its file as this one's. Naming the project
closed the hazard, and the fence went with it.

The **operate** fence was mine and outlived its reason. The attach lane was never
fenced server-side; the seat-binding was inherited from the days when reads were
seat-only, and it survived as habit after the thing it protected was gone.

The **watch** fence fell to four probes rather than an argument. It existed on
the reasoning that @prax is anchor tooling that monitors the repo it lives in —
a rationale its own author proposed and then disproved: `monitor run baud`
answers *"Live — scoped to BAUD"*, identically from the anchor and from the
project's own root, so the working directory was never the variable anyone
believed it was. And where @prax genuinely cannot show something, it says so on
the screen the operator is already reading rather than failing. A live accurate
warning beats a guess at the door, so no fence — and no allowlist of watchable
projects either, which would only be a second model of @prax's scope, drifting
from the first time they change it.

**`settings` is the one that stays, and it is worth stating twice.** It is the
only door here that would not fail loudly: it would open — and let the operator
*edit* — a same-named **local** agent's claude config while the header named the
foreign one. A door that refuses is visible; a door that succeeds against the
wrong target is found later, somewhere else, as damage. It stays shut until that
route learns the second half of the address.

**A mounted pane never consults the poll again — freeing the browse made that
load-bearing the same evening.** Patrick, with a screenshot: *"the terminal will
not stay persistent — I can change project and the terminal drops your chat.
nothing changes the terminal agent except my hands."* The cause was one line in
the pane renderer: every pane re-resolved its card by *name*, on every render,
out of the **seated** project's list. That was harmless while the face could only
reach one project. The moment the header could point elsewhere, the lookup missed
for any pane whose agent lived in the project you had just left, the pane fell
through to a *"no longer in the fleet read"* line, and unmounting a terminal sheet
closes its socket. Browsing dropped the room.

The desktop never had this bug, and the reason is **structural rather than
careful**: its `<Terminal>` is mounted once with no branch prop at all and holds
its own room internally, so there is no lookup available to miss. The fix ports
that model into the phone's tab architecture rather than patching the lookup: a
pane now carries the card **as it was when the operator opened it**, and the live
poll is never asked about a pane again. Both *"no longer in the fleet read"* arms
are gone from the file, because that state was never a real one — a room with a
tmux client on the other end does not stop existing when a list changes.

**Unmount happens on exactly three hands, all of them the operator's:** the
attach swap (the one-agent-seat replacement), `end room`, and the tab's `✕`. A
pane whose branch has dropped out of the current read keeps its socket and keeps
typing.

**The pane key is project-qualified now, with one deliberate exception.** The host
names a room `baud-<project>-<branch>` and a shell `baud-shell-<project>-<branch>`
— the project is part of a room's identity *on the host*, so a key that omitted it
described a room that does not exist. Free browsing made that live: two projects
can hold a same-named agent, and the unqualified key made the second one look
already open, so attaching it would have focused the first one's pane and left the
operator typing to the wrong agent under the right name. The project-root shell
was the worst of them — `@project` was the same string for every project on the
machine. The exception is global mission control, which names no branch **and no
project** on the wire, so its key names none either; qualifying it by seat would
have stacked identical monitors as you flicked between projects.

The keys are also no longer written by hand anywhere. Two call sites had spelled
one out as a template literal, which is exactly the thing that goes stale the
first time the shape changes — and it had just changed. Both now build the key
through the same function every other site uses, so the detach affordance and the
close gesture cannot drift from the pane they name.

**The wheel's avatars carry the desktop's two marks**, from the same payload and
on the same rulings: a manager's disc is ringed blue, and a disc with sub-agents
running fills red on the beat. One indicator wearing two sizes — when the pulse
turned out to be invisible on the desk it was fixed on both faces together,
because the phone's 44px disc had even more steady colour to hide it.

**The sheet states the sub-agent count in words**, on the status line rather than
in the counter row. Every tile in that row is a *door* — press `MAIL` and the
inbox opens — and sub-agents have no file to open, so a fifth tile would be a
dead button among four live ones. It is also a different kind of fact: the four
counters are standing figures, this one appears and vanishes with activity.
**Zero is stated, not hidden** (`no sub-agents running`), because a sheet that
renders nothing at zero is indistinguishable from a sheet that does not report
sub-agents at all — which is exactly the gap that put this line here. The rail
says *that* something is running; the sheet says *how many*.

**The passport opens from the door row, not from the avatar.** On the desk the
avatar *is* the door; here the equivalent disc lives on the wheel, inside the
tap target that opens the sheet, and nesting a second target inside it at that
size would trade the gesture the whole face is built on for a mis-tap. So it
joins `files`, `shell`, `watch` and `settings` at finger size. What opens is the
desktop document's **content and order** at 46 columns, not its layout: the
fields *stack* (label over value, which is how a real passport prints a field
and what stops a Purpose sentence living in thirty characters), the four memory
tabs scroll sideways rather than wrapping to two rows that would change height
under the reader's thumb, and each entry clamps to six lines with the **whole
entry** as the tap target that opens it — a fleet session summary runs past a
thousand characters, and four of those unclamped is a wall rather than a
document.

*Two things in that paragraph moved off the passport on 2026-08-17 and are kept
here rather than rewritten, because the reasoning is still why they look the way
they do — see* **The passport is only a passport** *below: the memory tabs are
now the card's own `memory` screen, and a manager's monitors are the card's
MANAGER zone. The sideways tabs and the six-line clamp travelled with them.*

Three facts about that document are worth stating because they are easy to get
wrong. It reads **names, never paths**: the desk asks for
`<path>/.trinity/passport.json` and this face's transport refuses absolute paths
by design, so the phone asks for `<branch>/.trinity/passport.json` — the shape
the stat tiles have used all along. It follows the **poll**, holding the card's
`project/name` ref rather than the card, so a sub-agent that starts while the
passport is open appears on it; and an agent that leaves the fleet closes its own
passport, because a modal that returns by itself on a later poll is a bug nobody
can explain. And a **refused read is printed in the host's own words** rather
than drawn as an empty document — which matters more here than at the desk,
because this face's read lane genuinely does refuse some branches (see below).

**`traits` arrives in two shapes, and only one of them used to render.** Most
passports carry a string; @devpulse's is a JSON array of six sentences. A
string-only reader printed an em-dash over a populated field — a document saying
*nothing here* about the manager whose passport is the most likely to be opened.
The phone reads both shapes and bullets the list. The desktop still has the
single-shape reader; it is frozen, so this is reported rather than fixed there.

*One desktop change has landed since that freeze, so the line is worth drawing
where the code draws it: the settings split below touched both faces, and it
carries Patrick's ruling in its own comments as the reason. The freeze has never
been a rule about files — it is a rule about **findings**: a defect this face
notices while porting is reported, not fixed on the desk. That still holds; the
`traits` reader above is one of them, unfixed on purpose.*

**A manager's passport carried the monitors** — until 2026-08-17, when they moved
one surface over to the card's MANAGER zone for the reason below; the doors and
their reasoning are unchanged, only their address. They were relocated exactly as they were on
the desk, and both doors are live. The commons feed is `drone @prax monitor run
commons`, a target the watch route names by keyword. Prax mission control is the
desk's *target-less* `drone @prax monitor run` — every branch at once — and on
the wire that is `kind=watch` with **no branch**, which is the one lane where an
absent branch is a real answer rather than the bug that kills a live session:
a watch names no session to take over.

That door shipped **disabled for one round**, and the reason is worth keeping.
The watch route could only express a branch monitor, and the `prax` *branch* was
a valid target sitting right there — pointing the button at it would have
rendered perfectly and been a different view, with an operator reading a branch
monitor as mission control and never learning otherwise. It shipped shut with
the reason on it instead, and the missing shape was reported measured rather than
described. It took twenty minutes to build the next evening. A plausible
substitution is worse than an honest refusal, and it is most tempting exactly
when the wrong answer renders cleanly.

Both monitors ride the **seat**, and that is a choice rather than a fence now
that external watches are allowed: mission control and the commons feed are
*this installation's* views, so a manager card browsed from another project
opens the monitors those buttons have always meant. A watch aimed at a
particular foreign branch is a different question, and the `watch` door on that
branch's own card is where it is asked.

### The standing screen is the wheel and the room

Patrick's screenshot verdict on the persistent layout: *"ok getting there. u see
no room for the terminal."* Three visible lines of room under four rows of
chrome. So the standing layout was stripped to exactly two things — the rail and
the terminal — and everything that was restating a fact moved to where the fact
already lived.

**The current-agent strip is gone.** *"All agent info goes in the card."* The
rail's dots and badges are the at-a-glance layer, the expanded card is the detail
layer, and the strip was a third copy standing between them paying rent in the
one dimension the terminal needs. Every figure it showed is already a door on the
card.

**The terminal's header row is gone too.** It cost a permanent row to say three
things: which room, that the room is attached, and a detach button.

**So the "which room is below" fact moved onto the rail itself** — an amber ring
on that agent's card, deliberately *not* the centred card's green. Those are two
different questions ("which card am I looking at" / "which room is below"), and
answering both in one colour would make the wheel say less rather than more. This
is where the deleted strip's split-naming sentence went: browsing away from an
attached room with nothing acknowledging it reads as a flick that failed to
switch, so the fact had to survive — it just no longer costs a row, and it points
straight down at the terminal it describes.

**Detach became a door on the card, and only on one card.** The agent whose room
is open offers `‹ detach` and *not* attach — "open this room" is not an offer you
can make about the room already on screen. Every other agent offers attach and no
detach. It is worded away from `end room`, which sits a few lines below it and is
destructive: this one closes a client, and tmux keeps everything.

**The status line survives, but only as news.** `attached · name` is what a room
looks like when nothing is happening, and a permanent row restating that is
exactly the rent this round collected. An upload in flight or a dropped socket is
news, and news gets a line.

Measured after: the terminal's screen is **66% of the viewport, 44 rendered rows**
at the new 10px default.

**Zoom returned, and it is real rather than cosmetic** — because the resize lane
works now. `A−` / `A+` set the size on the live terminal, re-measure with
FitAddon, and *send the new geometry*. Smaller type genuinely buys columns and the
room follows, because rooms are opened `window-size smallest`: measured 79×44 →
**88×49** on one press, with the resize frame on the wire and no reattach. Before
the deaf-room fix this control would have been a lie told to a room that could not
hear it.

**Fullscreen is a CSS class on the mounted node, never a remount.** This is the
trap in the feature: the terminal sheet is keyed by room, so anything that
unmounts it closes the socket — a fullscreen toggle implemented by moving or
re-rendering the node would have cost the operator the room every time they
pressed it. Verified three ways: zero detaches and zero attaches on the wire
across *both* enter and exit, the terminal's DOM node identity preserved through
both (tagged before, still tagged after), and a resize frame for the new geometry
each way. The room stayed typeable in fullscreen, and exiting returned to the
layout underneath with the rail at the same scroll position.

### The wheel stopped cutting people's names off

A screenshot round, and two of the five fixes in it were one defect wearing two
mechanisms. Patrick: *"the agent cards get cut off, and some words almost
completely covered."*

**The selected card is `transform: scale(1.28)`, and a transform does not change
layout.** The rail is still as tall as the *unscaled* card, so the scaled one
renders about 10px past it at each end — and the rail's own `overflow-y: hidden`,
which exists so a vertical drag never scrolls it, cuts whatever lands outside.
The bottom is where it showed, because that is where the label is: the
descenders of the selected agent's name were being sliced off. Fixed with
headroom rather than by weakening the overflow rule — 11px of vertical padding on
the rail, taken back out of the wrap above it so the terminal loses nothing. That
number and the `50vw - 32px` beside it are the same species: **one measurement
written in two places, and both have to move when the card does.**

**The label's own box was a second clipper** and would have survived the new
headroom on its own. `overflow: hidden` is there for the ellipsis, and it clips
vertically too — at the default `line-height: normal` a box that size leaves a
descender touching its own bottom edge. `1.4` gives the `p` in `devpulse`
somewhere to go.

**The edge cards fade now, because the clipping is real and should look
decided.** A rail wider than the screen always has a partial card at each end;
they were being sliced mid-circle with half a badge hanging off, which reads as a
layout accident rather than as *more fleet over there*. A mask fades the outer
26px each way — about a third of a card, enough to read as a fade, short enough
that a peeking card is still identifiable as one you can flick to. It changes no
geometry, no scroll extent and no hit target.

**`CTRL` was bleeding its border, and `flex: 1` is why.** That is `flex: 1 1 0%`
— every slot gets an *identical* width whatever is in it, so a row of one- and
two-glyph chips set the width and the only four-letter label in it overflowed;
`min-width: 0` then let it shrink below its own text, and with no overflow rule
the text simply drew past the border. `flex: 1 1 auto` starts each slot at its
content width and shares the slack, so `CTRL` takes the ~32px it needs and the
arrows give up a few they never used. Clipping with `overflow: hidden` was the
other option and would have shipped a chip reading `CTR` — a control that lies
about which key it sends is worse than one that is a few pixels wide.

**The smoke-test strip is gone; the selection it measured is not.** Round 1b's
readout — dashed amber, six live counters, deliberately ugly — existed to answer
one question on a real S24: *why does a drag collapse at 12-14 characters?* That
question is answered, so the instrument went, along with the counters behind it,
the drop detector that wrote its sentence, and the two window error listeners
that reported into it. What stayed is everything that turned out to be a
**mechanism rather than a measurement**: the forged shift-drag, the second-finger
guard, the `contextmenu` prevent (that one was always a fix), and the
ResizeObserver hold — a fit mid-drag drops the selection, so a drag holds the
observer off and pays the fit out on lift. Copy and clear stayed too, in a plain
row instead of the probe box: without them a selection is text a thumb can
highlight and never use, which would have deleted the *feature* while deleting
the probe.

**And the PWA manifest stopped describing a face that no longer exists** — it
still said *"the AIPass fleet, read-only, in one column"*, and the column went
when the wheel landed. The same sentence turned out to be sitting on the sign-in
door, which nobody had reported: `read-only` is a property of the **token** now,
not of the face, and that door is shown before either token is known. Both say
what is true of both scopes; the header's lock chip says which one arrived.

### The passport is only a passport, and the workbook got a door

*2026-08-17, compass #291.* The phone's passport had become a filing cabinet: an
identity document with four tabs of working memory inside it, a manager's
monitors bolted underneath, a sub-agent count printed a second time, and `class`
appearing both as a field in the list and as the answer to the manager question.

The ruling behind this round is one sentence — **the passport is a pure identity
document**, `passport.json` rendered as a document and nothing else. Every live
fact, every count, every door and every verb belongs to the agent card. One home
per fact; nothing renders twice.

So the round is mostly a **subtraction**, and nothing in it was deleted:

| what left | where it went | why |
| --- | --- | --- |
| working memory | the card's `memory` door — its own screen | four files the agent rewrites daily are the opposite of an identity document |
| the two manager monitors | the card's MANAGER zone | operational doors, and a passport has no operational doors |
| the sub-agent count | the card's state line, where it already was | it was printed twice, and it is a live number |
| `class` | the holder block, beside the name | which is where a passport prints it |

What the document keeps is the document: holder, role, purpose, traits, when it
was issued and under what number, the principles the agent declares, the
**stamps** it has earned, and one door to the official records behind it.

**The memory screen is a screen, not a sheet**, which is the files idiom rather
than the passport's: full height, one `‹ back`, sticky head, four tabs of
thousand-character summaries. Nothing in it is new work — the same two `.trinity`
files, the same by-name lane, the same reader that has to cope with four
containers written by four different hands. Only the address changed.

### The birth certificate, drawn as the document it is

Every other file on this face opens in the Reader as text, and that is right:
BAUD does not know what a report or a plan *means*. It does know what a birth
certificate means — @spawn writes exactly one, at exactly one name, with a shape
that has not changed in five months — so the one file in the fleet that is a
**document** gets drawn as one, behind the passport's records door.

Two conditions, both required, and they are in one place so they can be
disproved: the browse must be floored at `artifacts` (the passport's records
door, not the card's general files door) **and** the file must be the one
certificate at its one name. A `birth_certificate.json` found anywhere else
opens as text, because a designed document is a claim about provenance, and the
only provenance this face knows is *"@spawn wrote it here, when the branch was
born"*.

**The honest-absence rule is the whole design.** A field that is not in the file
renders **nothing** — no `N/A`, no *unknown*, no placeholder box waiting to be
filled. A certificate with no privileges block has no seal, and a greyed-out seal
would read as a grant that was revoked. And the renderer **declines**: it returns
null the moment the text is not a JSON object, and the Reader then prints the raw
file exactly as it does for everything else. That is not an error path — the raw
text *is* the honest render of a file that does not carry a certificate. Measured
rather than assumed: of the 16 birth certificates in this repo, @memory's is
**zero bytes** and three more (@commons, @flow, @skills) are literally `{}`.

The certificate's path is **one constant** shared by the renderer and the
passport's gold `ADMIN GRANT` stamp, because that stamp's only evidence is the
signed certificate itself — not a field on the passport, not a flag in the fleet
read. Two copies of the string is how a stamp and its document drift apart.

### The git app — the fourth layer is not an agent

*DPLAN-0303.* Every other door on this face is addressed to somebody — a card, a
room, a passport, a memory — and **the repository they all live in belongs to
nobody**, so it has nowhere to hang on a rail made of citizens. The wheel grew a
fourth layer for surfaces that belong to the project rather than to anyone in it:
`current project`, `live`, `dispatched`, **`apps`**.

It cost the stack the promised nothing — one row in the array, one pip, one
flash — but it needed a second **card shape**, because *a surface* and *a
citizen* must be one glance apart: apps are rounded squares in ember orange,
agents stay circles in fleet green, and the accent travels through the pips, the
notch and the flash together so arriving on the apps layer reads as one move
rather than four. An app card carries **no `data-name`**, so the centre report
that drives the terminal, the sheet and the whole context-bound half of this face
never fires on it: flicking down to look at the repository leaves the agent you
were talking to exactly where it was. There is no lane behind the list and there
should not be one — an app is a surface this face itself provides, so a server
that has never heard of it can neither add one nor take one away.

**Five screens and a stack.** Changes → one file's patch; commits → one commit →
one file's patch. The per-file patch is reachable from two places, which means
*back* is a question about where you came **from**, not about which screen you
are on; a stack answers that by construction, where five booleans in `PhoneApp`
would have to re-derive it and would get it wrong the first time a sixth screen
appeared. Deep screens also carry a **home chip** beside `‹ back` — same chip
family, one glyph apart — and screens with nowhere to go home to draw nothing
rather than a disabled control.

**Nothing is held across a close.** Every screen reads on mount, so re-opening
the app is a fresh read rather than a picture of a working tree that has moved
on. A phone in a pocket is out of date by definition; the fix is to read again,
not to cache harder.

**Two grains, one app.** Patrick's ruling, 2026-08-17: *"it should open just like
this but show only the agent local changes"* — the card's `GIT` tile used to open
a raw whole-branch patch, one unhighlighted wall of text, and it now opens the
same grouped list narrowed to that one citizen's working tree. So the grain is a
**prop, not a second component**: a copy of these screens scoped to a branch
would be the same four reads, the same refusal voice and the same grouping rule
written twice, and the second copy is where the two start disagreeing about what
a changed file looks like. The grain changes exactly three named things — which
floor the stack starts on, what the changes screen asks for, and how deep a group
cuts (three path segments at repo grain, where this fleet keeps its branch roots;
one at branch grain, where the root is already stripped). Grouping is
presentation and nothing else: it never adds, drops or reorders a row. A
repository laid out differently gets uglier headings and the same complete list.

**Divergences from the mock, each one upstream and named rather than faked.** The
patch renders with **three** lines of context, not the mock's one, because the
lane routes through drone's own door and that door recognises no `-U`
passthrough — a narrower context is asked for upstream and this screen inherits
it the day it lands, with nothing here to change. The commits list carries **two
short rows, not four fields**, because the log door runs `--oneline`: an
abbreviated name and a subject, no author and no date. They are one tap away on
the commit itself, where one read answers for one commit. And the list is
**always the whole repository** — that log door runs from the repository root
with no pathspec, so *"commits for devpulse"* would be a straight lie about what
was measured.

**Every file in a commit wears the same letter**, and that is a refusal to guess.
A commit's file carries additions and deletions and **no porcelain code** — a
commit has no index and no worktree columns to report — and two numbers cannot be
turned back into one. A file with no additions is as likely to be five deleted
lines as a deleted file. So every row says the one thing that is true of all of
them (*this commit modified it*) and the `+`/`−` numbers beside the name carry
what actually happened.

**One file at a time, by design** — the patch lane cuts a single file's block out
of the whole and refuses over 512KB rather than truncating, because half a patch
is not a small patch, it is a broken one. A commit's entire patch never crosses
the wire. The renderer is `react-diff-view` (MIT), consuming exactly what the
server sends: writing a unified-patch renderer by hand is writing a unified-patch
parser by hand, and every edge case it misses — hunk headers, no-newline markers,
renames, binaries — is a *wrong picture of a real change* rather than a crash.
Its stylesheet exposes every colour as a `--diff-*` custom property, so the
phone's palette drives it instead of a second set of hexes being pasted over it.

**Rows that leave.** Pull requests, issues and the remote are the forge's pages,
not this app's screens: they are anchors, they open a browser tab, they act on
the first tap rather than pushing a floor onto the stack, and they wear a corner
arrow so a card that navigates away never looks like one that opens a sheet. They
exist at **repo grain only** — a remote belongs to the repository, so the
branch-grain door the card's tile opens neither shows them nor asks for them —
and they ride @api's `/v1/git-remote`. The host stays in the displayed address:
`AIOSAI/AIPass` would look identical whether the remote points at GitHub or at a
box in somebody's basement. When there is no remote the server answers
`web: null` and the screen says so, rather than drawing a link to nowhere.

**The badge is its own lane, and a much slower one.** The per-branch sweep walks
the fleet one card at a time; the app's badge is **one** call for the whole
repository, and it is the most expensive read this face makes — a status over a
tree with seventeen branches in it. Two minutes between reads is well inside the
scale a repo-wide count moves on, and it makes the number a background fact
rather than a poll.

### The FILES app — the fence learns more than one kind of word

*FPLAN-0443, 2026-08-18.* Patrick: *"we dont have a file explorer… rn I can only
see into agent files, that file as is. and git changes shows changed files also
good but I can't explore home. or project files outside agents."*

**The browser was never the missing piece.** `FilesScreen` has been a real phone
file manager since the wheel landed — one level at a time, an up chip, a Reader
on the other side of a tap, status chips riding the rows — and it already opened
at two different floors. What it had no way to do was stand anywhere except
inside a citizen's directory, because **the fence answered exactly one kind of
word**: a branch name. So this round is not "write a file explorer". It is
*teach the fence more places to stand*, and let three existing components fall
through unchanged.

The apps layer's own comment promised the card would cost one row, and it did:
`FILES` sits beside `GIT`, second entry in the same array.

**The roster is the server's, and the face never constructs one.** `/v1/roots`
publishes the places — `home`, every project in the census, the AIPass root,
and the branches — each carrying a `kind`, a `name` and a `label`. The picker
renders that and echoes `kind` and `name` back verbatim. A roster spelled into
this face would be a roster that lies the day a project is added or renamed, and
the fence would then refuse a row the picker had drawn as real. So the screen
**refuses out loud rather than falling back**: no hardcoded home row, no "well,
at least show the branches". If the roster cannot be read it says so in @api's
own words and offers nothing, because a picker that invents one plausible entry
is how an operator learns to distrust the other twelve.

**One key on the wire, and it is absent by default.** `root` names the *kind*;
the first component of the path names the thing *within* that kind, which is
exactly where a branch name already sat. So the splitter, the browser, its
up-chip and the Reader all keep working untouched — the only new thing anywhere
is the kind, and it rides as a key that is omitted unless a caller names one.
Absent means the branch meaning these routes have always had, character for
character, which is the no-regression pin seen from this side.

Every root names its first component, including the ones that name nothing:
`home` and `aipass` stand in for themselves. That is not decoration — measured
against the live server, `branch` is a **required** query field (`422` without
it), and an empty first component would build a leading slash the transport
refuses by design. One expression in one place, so nothing downstream has to
know which kinds carry a name.

**The root travels with the file, all the way to the tab.** A file opened out of
the home directory is still a file, read by the same Reader through the same
lane; the only thing that differs is which floor the server resolves it against,
and that fact has to travel *with* the reference or the read lands somewhere
else. It is also part of the pane's **identity**: `README.md` in the home
directory and `README.md` in the AIPass checkout are not one document seen
twice, so the root joins `paneKey` — where the certificate flag deliberately
does not.

**Status chips are off outside a branch root, and silently.** The rows lane is
keyed *by a branch*: it answers what changed in one citizen's working tree.
Outside one there is no branch to key on, and sending a root's name where a
branch name goes would return either a refusal or — far worse — some same-named
citizen's change set painted over a stranger's files. So the listing goes out
plain, exactly the picture this screen drew before it learned to read status,
and **no banner says anything is missing**: an unpainted row claims nothing,
where a row painted clean would claim the file is unchanged. Never a false
clean. Lighting them at repo grain for the project and aipass roots is real,
named as a follow-on, and off here rather than guessed.

**The desktop refuses the roster by name.** There is no Rust command behind
`list_roots` and there should not be: the desk browses the project it is seated
in, from a machine with a file manager three feet away. `transport.ts` says so
in the mirror table, so the name fails as a designed absence rather than as
tauri's *command not found*.

**Measured before it was reported, and the dependency is honest.** As this
shipped, `/v1/roots` answers `404` — @api's half was building in parallel. Two
probes against the live host with a read token, revoked after: `root` is an
unknown query parameter today and is **silently ignored**, so `?branch=devpulse&root=project`
returns the branch byte-identically to the control. That is the wrong-picture
case in miniature — and it is structurally unreachable, because the only way to
reach a root browse is through a roster row, and there are no rows until the
door exists. The face is complete and inert until @api lands, then live with no
further change.

> **It landed the same day, and the paragraph above is kept rather than
> rewritten.** Re-measured 2026-08-18 against the live host: `/v1/roots` answers
> `200` with a home, an AIPass checkout and eleven projects; `/v1/dir?branch=home&root=home`
> lists the home directory and **echoes `root` back**, which is the ignored-key
> hazard closing itself. The prediction in the paragraph above is what makes it
> worth keeping — it was written before the answer was known, and it held.

**The exposure, kept where it can be found.** With a `home` root and Patrick's
standing *full operation now, security later* ruling, a **read-scope token reads
`~/.ssh/`, `~/.aws/`, `~/.gnupg/`, dot-env files and `~/.claude/settings.json`
from the phone over the tailnet.** The sentence elsewhere in this README that a
read token is a harmless mirror is no longer true of the file lane. devpulse
named the consequence before the ruling and it stands; this paragraph exists so
that the day it is revisited nobody has to reconstruct what was known when. The
reversal is small and nothing here forecloses it: a name deny-list in the
server's read module, and an operate gate on the home arm alone.

### The monitor row — the machine, live on the face

The wheel's last layer is the machine (FPLAN-0561; every clause ruled in
DPLAN-0341). Six cards — CPU, MEM, TEMP, FAN, NET, PROC — each carrying its live
headline, because Patrick ruled the glance is the point: *"a big 100% door a.
live on face"*, and *"6th card is in"* for the fan, the case he named when he
asked for the row (*"the fans going crazy and the screen is locked and it's all
the way across the room"*). Built 2026-09-13; his live verdict on the S24 closes
the row.

**Three owners, one piece each.** @skills publishes `machine_vitals()` and owns
every meaning in it — which sensor is the CPU, which rows are nonsense, what an
absence is called. @api proxies it verbatim on `GET /v1/machine` behind a 1 s
single-flight cache. BAUD draws it and decides nothing else. The Rust half the
placeholder round planned never happened: `sysinfo` has no fan API at all, and
psutil reads the fan today. The desktop has no command behind `machine_vitals`,
and its transport refuses the name out loud rather than failing at the IPC.

**The faces.** CPU and MEM draw their percent with a ring of the same percent.
TEMP draws the package °C with a ring of celsius over the sensor's own
`critical`, amber from 85% of the sensor's `high` and red at `high` itself (both
lines are 100 °C on the MacBook this was built on). FAN draws the percent of its
range with the ring; a fan with an rpm but no range (`no_range`) draws the rpm
and no ring. NET (sent plus received, per second) and PROC (a count) have no
range and never wear one. Colour is the temperature's alone — the only reading
that publishes a line to be warm against. The ring sits inside the card's border
rather than outside it as the mock drew it, because the centred card's scale
already spends the rail's vertical headroom and an outside ring was cut off on
exactly the card being read.

**Absence is not zero.** A section the host cannot give draws a dash — and on a
gauge a dead ring — and its sheet prints the skill's own sentence for the reason,
with the detail when there is one. `warming`, the first read after the server
starts, has no CPU or network window yet and renders the same way. A 503
(`psutil_missing`, `switched_off`) turns every face to a dash and the sheet
prints the owner's message.

**The cpu page shows the cores** (FPLAN-0586, 2026-09-13; Patrick: *"when i open
it id expect to see the cores"*). One bar per online CPU in the skill's `cores`
list — never one per configured count, which can differ — then one line of what
the machine has (*4 threads on 2 cores · 1.1 GHz, up to 3.3*), then the three load
averages with a caption saying what they mean against the live thread count. The
percent row, which repeated the headline, is gone, and the sample window rides the
sampled line. While the section is warming the bars give way to the skill's
sentence, never to zero-height bars; any count or clock the host cannot give
prints a dash, and a missing clock's reason (`detail`) sits under that line.

**Read while looked at, and only on that row.** `lib/machine.ts` polls every 2 s
— past the server's 1 s cache, so every read is a fresh sample — through
`whileVisible`, and only while the monitor row is the visible wheel. Leaving the
row stops the lane and forgets the reading, so arriving again shows bare marks
until a fresh answer lands rather than last visit's numbers dressed as live ones.
The sheet opens over the wheel without moving its layer, so it stays live. The
route takes no query parameters, ever — a cache-buster included. PROC's list —
what is running, by cost — is a deferred row with its own route, and its sheet
says so.

### A path you can hand to someone

*FPLAN-0443 rider, 2026-08-18.* Every row the files screen paints — a file, a
directory, and the row for a file git says is **gone** — carries a **copy**
button, and so does the reader's header, because half the time you are already
inside a file when you want its name. It copies the **machine path**.

**Why it has to be the machine path, and why that needed the server.** Every
path this face sends is a *name*: `<branch>/<relative>`, resolved by the server
against a floor the phone never learns. That is exactly right for asking and
exactly wrong for handing to a person — a relative path pasted into an agent's
prompt resolves against wherever that agent happens to be standing, which is a
different tree often enough to matter and is never flagged when it goes wrong.
So `/v1/dir` and `/v1/files` gained one key, `floor`, the absolute path of the
resolved root, and `app/src/phone/lib/copyPath.ts` puts the relative back on the end
of it. **No floor, no copy:** the button answers *"the server did not say where
this root stands"* under the row rather than handing over half an answer.

**The lane that exists because of the device it runs on.** This face is served
over plain http on the tailnet, and `navigator.clipboard` is **undefined in an
insecure context on Android Chrome** — the exact browser this face exists for. A
copy button written against the modern API alone works on the desktop it was
developed on and does nothing at all on the phone, silently. So the legacy
`document.execCommand` textarea lane is not a fallback for old browsers; it is
the only lane on the device that matters, and the modern one is the courtesy.
The order is **synchronous-first** on purpose: `execCommand` only works inside
the gesture that asked for it, and awaiting a promise ends that gesture, so the
absent-API case never awaits anything.

**Nothing is assumed to have worked.** Both lanes report — the promise resolves
or rejects, `execCommand` answers a boolean — and the button shows `copied` only
on a confirmed copy. A tick that appears whether or not the text moved is worse
than no tick, because it is the operator's only way to know. The mark does not
time out, either: the clipboard has no timer, so a tick that faded after two
seconds would be claiming an expiry that never happened.

**What the brief said and what measurement said.** The composition rule handed
down was `floor + "/" + relative` with `filter(Boolean)` *"so no double slash"*.
Run against real inputs it turned out not to be enough — a floor of `/` is
truthy, so `["/", "notes.md"].filter(Boolean).join("/")` builds `//notes.md`,
which is the one case the rule was written to prevent. No root resolves to `/`
today, so it was latent rather than live; it is fixed and the five measured
cases are written into the function's own doc.

**What the layout cost, named.** A button cannot contain another button, so the
row became a flex line of three things — the name, the copy button, the status
slot — and the status chip moved out of the tap target to sit at the row's outer
edge. Tapping the 17px chip no longer opens the file; tapping anywhere else on
the row still does. Every row now reserves the chip's 17px whether it has a
status or not, so the copy button lands in one column all the way down the
listing instead of stepping sideways on every unchanged row.

### Nothing polls a pocket

*DPLAN-0305, 2026-08-18, from Patrick's "the more we add to baud I've noticed
more and more lag".* @devpulse's audit measured this face at **~30.5 requests a
minute on every screen, phone-screen-off included** — four pollers at the top of
`PhoneApp` that ran for the life of the app and asked nobody whether anyone was
looking. Two things changed; the intervals themselves deliberately did not.

**A poll only runs while somebody is looking.** All four lanes — the fleet and
roster snapshot, the wheel's per-branch git sweep, the bell's badge, the git
app's repository count — now start through `phone/lib/whileVisible.ts`, which stops
the interval on `visibilitychange` and restarts it, **with one immediate tick**,
when the screen comes back. The tick on wake is what makes the gate safe rather
than merely cheap: a lane that only paused would hand back a wheel frozen at the
moment the phone went into a pocket, where this hands back a wheel read at the
moment you looked at it. Strictly fresher than before, at the instant it
matters.

*The browser's own background throttle is not this.* A hidden tab's timers are
slowed to roughly once a minute — a courtesy, not a contract, differing by
browser and not applying to an installed PWA the same way everywhere. Slowed is
not stopped, and the host serves these on one event loop with blocking work in
the handlers, so a request nobody will ever see is a slice of that loop the
terminal's websocket does not get.

**The badge stopped asking for the feed to count it.** The bell's poll fetched
up to a hundred full events every ten seconds, forever, to render one number.
Measured on the live host: **23,273 bytes an ask, and 228 with the cursor** the
feed screen beside it has always used. The merge rule that makes a cursor safe —
the server re-delivers the boundary event on purpose, at-least-once, because a
dropped alert is worse than a duplicate — moved into `phone/lib/feed.ts` so both
readers fold one feed the same way. A badge and a list that count differently is
the phone telling two stories about one feed, and the feed screen's own doc said
so before the badge had a cursor to get wrong.

**Two badges stopped building lists they never read.** The wheel's sweep asked
for a branch's changed files and read only the count; the git app's repository
badge asked for every changed row and read only `.length`. Both now ask through
`git_change_count`, a third name on `/v1/git-changes` that unwraps to two
numbers. The rows still cross the wire — a count-only parameter is @api's to
add and this face does not wait on it — but nothing is materialised here for a
number to be lifted back out of. The repository badge became `count +
untracked`, which is the same number **by construction and not by coincidence**:
the server appends every changed path to `rows`, counts the untracked ones
separately and puts the rest in `files`, and `count` is `len(files)`. Measured
three times on a live tree at 12 + 3 = 15 = `len(rows)`, and there is no cap on
either side for them to drift through.

**What did not change, and why it is listed here.** `POLL_MS` (10s) and
`GIT_SWEEP_MS` (5s) are untouched: how stale a wheel is allowed to look is an
operator-visible call, not a performance knob, and it is measured after these
land rather than guessed alongside them. The request *rate while you are
looking* is exactly what it was.

**And the fifth lane, one round later.** The feed screen's own poller is
screen-scoped — it stops existing when the screen closes — so it was not among
the four app-lifetime pollers gated first. It was still the only lane that could
tick behind a locked phone: leave that screen open, pocket the phone, and it
asked the host for a window every ten seconds until the battery said otherwise.
It goes through the same gate now, and **`whileVisible` holds the only
`setInterval` left in the phone face** — every repeating lane on this face is
gated by construction rather than by discipline. The wake tick earns its keep
most here, on the one screen whose whole job is to be current.

**And the machine lane, gated twice** (FPLAN-0561, 2026-09-13). It goes through
`whileVisible` like every other lane, and ALSO only runs while the monitor row is
the visible wheel — the wheel reports its layer up, and leaving the row tears the
lane down and forgets its reading. So the one lane on this face that polls every
2 s costs nothing on any other layer, and nothing in a pocket.

### One message a frame

*DPLAN CPU round, 2026-08-19, from Patrick's measurement of his own laptop: with
the desktop face open and doing nothing visible, the webview held 40% of a core
and the backend 35% - **~75% steady**, after nearly four minutes of uptime.* His
words were the whole brief: *"phone is my only option at these numbers."*

**The suspects were wrong and the measurement said so.** A poll loop, an
animation that never idles, a face that re-renders per event - none of them.
Measured against a room attached and nothing printing in it, the whole face
costs **~3.4% of a core**: the fleet snapshot is 40ms of CPU against a 5s
cadence, the pty reader is a blocking read rather than a spin, the resize path
is debounced through `cancelAnimationFrame`, and the two infinite `box-shadow`
animations only exist while a card is actually dispatched or actually running
sub-agents. The cost was never idle cost. It was **stream** cost.

**And the stream's cost rides on the number of messages, not on their size.**
Two loads through one attached room, same terminal, same window:

| what the room printed | bytes | writes/s | cost |
| --- | --- | --- | --- |
| nothing | 0 | 0 | 3.4% |
| a whole 48-row screen, 10x a second | ~44 kB/s | 10 | 32.9% |
| ~200 tiny flushed writes a second | ~1.6 kB/s | 200 | **134.5%** |

Twenty-seven times fewer bytes cost four times the CPU. That is the shape of an
agent streaming tokens, and it was the shape of Patrick's laptop.

**So a read stopped being a paint.** `pty.rs` gathers what the pty hands back
for one 60Hz frame and crosses the bridge once, on a thread that sleeps on a
condvar while the terminal is quiet - an idle terminal wakes nobody at all. The
token stream falls to **90.9%**, and the two cases with nothing to merge do not
move: 3.3% quiet, 31.1% for the bulk repaint. Nothing is dropped, nothing is
reordered, and the exit event still crosses behind the last byte the session
wrote. The only thing spent is up to one frame of latency on an echoed
keystroke, which is less than the paint that character was waiting for anyway.

**What is left is per-paint work, and the knob proves it.** Halving the budget
to 33ms takes the same stream to 60.7% - close to linear in the frame rate. That
says the remaining cost is the terminal drawing, not the bridge carrying, and it
is why the next lever is the renderer rather than a smaller number here: BAUD's
terminal runs xterm's **DOM renderer**, because a canvas or WebGL addon for
xterm 6 exists only as a beta today. Taking a beta dependency into this face,
and dropping the terminal below 60Hz, are both look-and-feel rulings rather than
performance tricks, so neither was taken quietly.

**Named and not fixed in the same round:** the desktop face has no visibility
gate at all. Five `setInterval` lanes - the fleet snapshot, the roster, two git
sweeps and the bell - run at full rate whether or not the window is on screen.
`whileVisible` was built for the phone in DPLAN-0305 and never crossed over.
That is real, it is cheap, and it is a different round from this one.

### A line says what it is

Output leaves the room one frame at a time; input arrives in a **declared
shape**. Patrick's report of the phone composer was that pressing Enter did one
of three things at random - sent and submitted, dropped the text into Claude
Code's own box without submitting, or appeared to do nothing. Two independent
causes, which is why it looked like luck.

**The first is a race, and it was measured rather than reasoned about.** The
composer wrote the line and its carriage return as two separate frames, which
become two writes into the PTY. Whether the far end reads them as one chunk or
two is decided by the network:

| gap between the two writes | what the program reads |
|---|---|
| 0 ms | `line\r` as ONE chunk - 30/30 |
| 1 ms and above | `line`, then `\r` - 30/30 |

A knife edge at about a millisecond. A reader with paste detection - Ink, which
Claude Code is built on - treats a CR buried inside a chunk as pasted text and
does not submit, and a lone CR as the Enter key. Same tap, same button,
different answer, decided by wifi.

The cure is not a longer gap - a bigger sleep moves the odds without making
anything certain. The line goes out wrapped in **bracketed paste**, so the
literal is marked as pasted text and the `\r` after the closing marker sits
outside it, unambiguously a keypress. Measured through a real tmux client, all
four landings of the race are correct at the pane boundary.

**And that was still not enough, which the device said and the bench could
not.** On the first live run one send passed, the next stranded through those
very markers, and the send after it submitted the *stale* line while the fresh
text did not appear. One mechanism explains both: the CR is acted on before the
paste it follows has been committed, so it submits whatever the box held a
moment ago and the pasted text lands in the emptied box behind it. An ordering
inversion, not a paste heuristic. Worth naming that bash's readline - a genuine
bracketed-paste reader - handles both shapes correctly, four for four, so this
is specific to the far end and no reader available here reproduces it.

So **the submit byte now waits for proof rather than for a clock**. This face
already renders every byte the room emits, so it watches the room's own buffer
for the line to appear and submits the moment it does - the CR cannot overtake
a paste that has already been drawn. Whitespace comes out of both sides of that
comparison, because a wrapped line is broken across rows and a box pads what it
draws. A line already on screen is counted before the send, so re-sending the
same text cannot be satisfied by its own older copy. There is a ceiling: a
program that echoes nothing still submits, because refusing to submit would be
a worse failure than the one being fixed.

**Whose mode is being read** is worth stating, because the obvious answer is
wrong. Every room is a tmux session and the phone is a tmux *client*, so the
peer parsing these bytes is tmux - and tmux enables bracketed paste on its own
client unconditionally. That is exactly what makes reading it correct: the
entity whose mode is read is the entity that interprets the markers. tmux then
normalises, re-emitting the paste with markers to a pane that asked for them
and **stripping them** for a pane that did not, so a program with no paste
detection never sees an escape sequence it never requested.

**The second cause was Enter itself.** The composer tested `event.key ===
"Enter"` on keydown and nothing else, which is the one signal Gboard does not
deliver: with predictive text on, keydown arrives as `Unidentified` and the
intent only exists in `beforeinput`. The handler never ran, the textarea took
the break, and the sanitiser flattened it to a space. Both signals are caught
now, guarded by `isComposing` - an Enter that closes an IME composition is the
operator accepting a word, not submitting a line - and de-duplicated, because a
double submit would be worse than the bug being fixed.

The send button and Enter run the identical path, to the byte. Patrick's own
observation that the button was *exactly* as unreliable is what proved the race
lived below the keyboard at all, and the two are now the same call so they
cannot drift apart again.

### The room is a view

**No tap opens a keyboard into the terminal.** A tap in the bottom five rows
used to arm the IME so the operator could type into Claude Code's own compose
box - a door built on purpose, and the one that became the trap. Aiming for the
baud box and catching the room instead meant typing *blind* into a box you
cannot see, and mobile IME into a terminal is unwinnable by construction:
composition and autocorrect mean the characters that arrive are not the
characters you typed.

Patrick reproduced the ceiling of that on demand. Typing `/help` in Claude
Code's box drove its slash menu to **`prep`** - the same way `/clear` once did.
His composed characters never reach the menu as keystrokes, so it never
filters, and Enter takes whatever is highlighted. The wrong command runs. He
caught it in time; the mechanism is now reproducible rather than folklore.

So the door closes and the trap dies **structurally** rather than by being made
more accurate - with no focus there is no blind typing to recover from. Every
job focus was load-bearing for is untouched: a tap still reaches tmux as a
click, xterm still runs its own word selection, and the timing that made that
work is unchanged. Only the answer is now always no.

**The stated-intent door survives, pointed somewhere safe.** Arming ctrl or alt
is typing intent said out loud, and it needs a keyboard - "ctrl then a letter"
has a letter in it. That keyboard now opens against a one-pixel field the chip
row owns, never against the terminal. BAUD reads what lands in it, translates
it, and writes the byte itself, so what crosses to the pty is a byte this app
chose rather than whatever an autocorrect decided a moment later. Composition
cannot reach the room raw because composition never touches anything the room
can see. The field is caught with `beforeinput` for the round-2 reason - under
a predictive keyboard the letter exists only in the composition - and a
modifier is never cleared when that field loses focus, because the arrow chips
honour a latched modifier and tapping one can move focus.

**A bench, and one suspect eliminated.** With the keyboard up, the room shrinks
and tmux's status bar lands at the new bottom, but Claude Code's composer row is
not visible above it. Two suspects were named. The client's scroll offset is
ruled out by the observation itself - if the true last row is at the bottom, the
view is not scrolled up. And tmux is ruled out by measurement: a real client
shrunk from 24 rows to 10 keeps a bottom-anchored UI at the bottom of the pane
whether or not the program redraws on `SIGWINCH`. What the bench *did*
reproduce is a frame taller than the room it must fit: at six rows of UI in four
rows of pane, two frame lines collide on one row. That is the program's own
rendering at a size this app asked for - which makes the lever a **floor on the
rows BAUD will ask for**, not a fix here. Named, priced, not taken.

### Typing goes back into the room, through a door that is stated

Making the room a view closed the mis-aim trap and took something real with it.
Patrick, the same evening: *"yea u guys pretty much took termial typing away I
cant type in any termi al now... only via baud comment box."* The trap and the
capability came through one door, and shutting it shut both — for **every** room,
not just Claude Code's: a shell prompt, a REPL, any TUI.

**The compose slot** is the door back, and it is one rectangle with two modes.
Default it is the baud composer, unchanged: attach, a predictive textarea his
voice dictation lands in, commit-on-send with the draw handshake behind it. Tap
the `room` door on its left and the whole rectangle becomes the armed bar —
`typing → the room · raw keys · tap to stop` — and every key goes to the pty.

It did not start there. The door was picked off a probe of three candidates
after Patrick tested all of them (*"type a and b actually cover the typing by a
bit. type c is only one that works."*), and type c was a bar with **its own
permanent row** between the room and the belt: the two cheaper doors cost no
height but put their control on top of the line being typed. He bought the row
knowingly. Then typing mode worked, and the row he had bought turned out to be a
second compose surface parked above the first — *"type in this room, its going
to be the only chatbox we need... I dont need 2 comment boxes"* (00:39,
2026-08-20). So the bar moved into the composer's footprint and the row went
back to the terminal: **32px, about two rows**, measured at 360px off the built
stylesheet — the belt goes 143px to 111px with the box empty.

**What merged is the footprint, not the mechanism.** The room still takes raw
keys and the box still predicts, because the two cannot share one surface (see
the trade below). One slot, two modes, and only ever one of them mounted — so
there is no greyed-out second surface beside the live one to mis-aim at.

**The cost is width, and it was measured rather than estimated.** The `room` door
takes the compose field from 221px to 175px at 360px — about 23 characters a
line down to 17 — so the same message wraps into more lines. The field's
max-height went from 7.2rem to 8.6rem to pay for it: roughly 120 characters of
his message were visible at once before, ~112 now, where the old cap would have
left ~89. The door is a **word**, not a glyph, in a 40px box that matches the
paperclip's: a mode states itself in words, which is Patrick's rule and the one
thing this round would not trade for pixels.

What arming does **not** do is reopen the old door. No tap on the terminal opens
a keyboard, ever. What changed is *where the fence sits*:

**Arming moves the mode, not the target.** Round 3's fence was built out of
focusability — the room's own keyboard surface, xterm's hidden textarea, was made
unable to raise a keyboard at all. That closed the trap and closed the only lane a
terminal has for real typing with it. The fence stays and becomes a **mode**:
disarmed, that textarea carries `inputMode="none"` and a stray tap in the room
raises nothing; armed, it is an ordinary text field, the browser composes into it
and xterm paints the in-progress word on the cursor cell. Disarming blurs it,
which puts the keyboard away and empties it. **Who carries the finished word to
the pty changed in round 6** — see below; xterm draws, BAUD delivers.

**The mirror-diff is deleted, and it is deleted on evidence.** Door C typed into
a hidden field of BAUD's own and reconstructed the room's line by diffing that
field against a remembered copy. noVNC shipped that exact pattern — PR #301, 2013,
for our exact reason, that Chrome on Android sends no usable key events — and then
**removed** it, because a mirror cannot know when the far end rewrites its own line
(issue #357, closed in 2015 without a fix). A tmux room rewrites its line
constantly: tab completion, `ctrl-R`, prompt redraws, background output, vim's
modes. Every one of those desyncs the copy, and the next keystroke pays for it
with backspaces computed against text the operator never typed. Guacamole does
ship a text-input mode, and it survives only on three invariants door C lacked —
a zero-lifetime buffer, no remembered-value diff, and a flat refusal to interpret
in-flight composition. What ships here needs none of them, because it keeps no
copy of anything.

**Round 6: xterm delivers a keystroke by reading the field back out, and a
predictive keyboard never fills it.** Patrick, live, on the round that armed
xterm's textarea: *"ok i can see what im typing but only the word im typing i
press space it disappears"* — preview alive, committed word gone, and zero bytes
at the pty to show for it. Every delivery path in xterm 6.0.0 resolves a
soft-keyboard keystroke by reading `textarea.value`: `_finalizeComposition` takes
`value.substring(start)` in a `setTimeout(0)` after `compositionend`, and the
"any textarea changes" lane diffs the value against a copy. The **preview** is
drawn from the *event's* `data`, never from the field — so it renders identically
whether the field ever took the word or not. That is the whole of the illusion:
the one visible thing was the one thing not reading the broken source.

So BAUD stops reading the field and reads the **intent**, which carries its own
payload: `compositionend.data` is the committed word, and `beforeinput` carries
the space, the digits and punctuation prediction never composes, Enter (`\r`),
backspace (`\x7f`) and paste — the ones xterm drops on Android, where its input
handler requires `!composed || !keyDownSeen` and a Gboard insert is composed
while a keydown is still open. While the bar is armed, `attachCustomKeyEventHandler`
returns `false`, so **no key event reaches xterm at all**: the paths that could
only repeat a keystroke or send an empty one are cut at the root. Composition
events are not key events, so the preview is untouched by that cut.

**Measured against a real Chrome IME, not reasoned about.** The lane was driven
over CDP — `Input.imeSetComposition` and `Input.insertText` are the same code
paths a soft keyboard drives — against a real xterm 6.0.0, in two worlds: a field
that takes the composed text, and a field frozen empty (the device's evidence).
Six scenarios, both worlds. The old lane reproduces Patrick's sentence exactly on
the frozen field — `word+commit` delivers `''`, `word+spacekey` delivers `' '`,
`word+enter` delivers `'\r'`: the punctuation arrives, the word never does. The
new lane delivers the full string in all twelve runs, and the composition view is
`active` while composing and hidden after, in both worlds.

The probe also **caught a regression before the device did**: when the space
arrives as a *key* while a composition is open, Chrome commits the word and fires
**no `compositionend` at all** — the only trace left anywhere is the last
`compositionupdate`. The first cut of this round blocked xterm's key path and had
nothing to read, so it lost the word on exactly the keystroke the round exists to
fix. Hence the third source: a non-composing edit arriving while a composition is
open *is* the commit, and what was composed goes out first, in the order it was
typed, de-duplicated against whatever already went.

**What xterm's own textarea buys for free.** It is parked **on the cursor cell**
as the cursor moves, and in-progress composition is painted there in the
terminal's own font. Text appears in the room as it is typed — the thing Patrick
asked for — because the browser draws it where the room says the cursor is. No
code here draws it.

**The honest trade, said on the bar.** Per-keystroke terminal input and predictive
text cannot share one surface; nobody has shipped both. That is exactly why the
merge above is a footprint and not a mechanism: the two modes share a rectangle
because they can never share a surface. So the armed bar says which one you are
in — `typing → the room · raw keys · tap to stop` — and stepping out of it gives
the predictive box back, in the same place. Termux, the reference Patrick trusts,
behaves identically: raw keys, no suggestion strip, dictation that prints on the
pause instead of streaming.

Round 6 softens that sentence rather than repealing it: a word Gboard *commits*
now arrives whole, because BAUD reads the commit off the event. What still cannot
be had is the strip's per-keystroke correction of a line the room owns — the room
is not a text field, and nothing here pretends it is. The armed bar still reads
`raw keys`, and that wording is now narrower than the truth; it stays until
Patrick has judged the lane on the device, because renaming a control mid-test
changes what he is testing.

**The one-pixel field stays, for the modifiers only.** `ctrl` and `alt` still open
the keyboard against the chip row's own input, where a letter is read, translated
and written as a chosen byte. That lane never touched the room and does not now.

**The room slides; it does not shrink.** If you type into a room you have to see
the line you are typing, and the keyboard covers the bottom, which is where every
prompt lives. Shrinking the box so the fitter drops rows would mean a pty resize
on every keyboard open and close, and a re-render into a shorter pane is the
frame collision behind the garbled lines. So the grid is left alone and moved:
its bottom edge lands at the top of the lifted belt and the screen clips the
rest. Nothing reflows, the room keeps every row, tmux is never told anything.

The distance is measured against **the belt's rendered top edge**, not against
the viewport. The belt is lifted to sit *above* the keyboard, so it — not the
keyboard — is what the last row has to clear; sliding to the visible bottom
parks that row squarely behind it. A rendered rectangle also stays true when the
belt changes height, which it does on every mode flip. It was the only reference
that survived the viewport change below, too: for a while the app asked for
`interactive-widget=resizes-content`, and under that token any distance computed
from viewport arithmetic collapsed to zero — the slide did nothing on exactly
the device it was written for. `getBoundingClientRect` needed no telling.

**And the slide runs for any keyboard, not only for armed mode.** The gate used
to be *armed and covered*, from a world where the composer's keyboard shrank the
room instead of hiding its bottom. It does not shrink it any more (below), so a
composer keyboard would leave the prompt — and whatever he just sent — behind the
belt. Nothing is told to tmux either way, and with no keyboard the distance is
zero by construction, because the belt's top edge *is* the screen box's bottom
edge.

### The keyboard stopped resizing the room

`phone.html` asked for `interactive-widget=resizes-content` from DPLAN-0301
until 2026-08-20, to keep the bottom key row off the keys on Chrome. That token
shrinks the **layout** viewport, and round 7 finally caught what else it was
doing with that: `100dvh` on `.baud-phone` shrank with it, so
`.baud-phone-term-screen` shrank, so the `ResizeObserver` fitted and **resized
the pty**. The room went to one or two rows the moment the keyboard opened, and
a TUI cannot paint a composer in one row. Claude Code was not eating his word —
the room had no height to print it in.

The token is now **unset**, which is the browser default `resizes-visual`: the
keyboard shrinks only the visual viewport. The room keeps its ~26 rows and
slides under the keyboard instead, and tmux is never told anything, so there is
no reflow to survive. The half the token used to carry — keeping the key row off
the keys — is the belt lift's job on every browser now, exactly as it always was
on Firefox, which never honoured the token at all. If that lift ever fails the
answer is to float the belt and floor the screen at ~10 rows; it is not a return
to `resizes-content`.

**And the fit still waits for the box to stop moving.** The observer's fit is
debounced 120ms and **trailing**, so the pty is asked once, for the size the box
came to rest at. That began as a defence against the keyboard animating the
layout viewport shut a frame at a time — a `fit()` and a `resize` frame each,
which is the re-render-into-a-shorter-pane collision the slide exists to avoid.
The keyboard cannot do that any more, and the debounce stays because it was
never only about the keyboard: a rotation, a pane opening, and the belt changing
height all move this box. The immediate declarations are untouched: on attach,
on a font change, on a fit held back through a drag, and on every return to
visibility. Taps improve rather than degrade — the hit test measures the
transformed box, so the slide corrects the aim instead of skewing it.

One consequence worth naming: because characters reach the room as real bytes as
they land, everything interactive works again — a shell's tab-completion and
history, a REPL, and Claude Code's slash menu filtering as you type. The deaf
menu dies as a side effect rather than as a feature.

### A reload that actually reloads

The header name reloads the face. It could serve a **stale** one, and did: a
round was declared failed live on evidence that turned out to be the previous
bundle still running after a reload through this very button.

The host answers `GET /` with an `etag` and a `last-modified` and **no
`cache-control`**, and a response with no explicit freshness lifetime may be
cached heuristically — the usual browser rule being a tenth of the age since
`last-modified`. So an entry document an hour old is treated as fresh for
minutes and a plain reload can be answered wholly from cache. Content hashing
makes that *worse* rather than better: the bundle names live inside that
document, so a stale entry means the browser faithfully fetches yesterday's
bundle. The assets are safe by construction; the entry that names them is the
hole.

The reload now re-reads the entry over the network first (`cache: "reload"`,
which fetches from network **and** updates the HTTP cache) before navigating.
This is the client half and not the fix — one `cache-control: no-cache` on the
host's HTML response is the real answer, and it belongs to the API. It is also
deliberately best-effort: if the network read fails the reload still happens,
because a refresh button that refuses to refresh is worse than one that
occasionally refreshes to the same bundle.

### The phone re-states its size every time he looks at it

*FPLAN-0446.* The phone is a real tmux client and sizes like one. It used to
say so exactly twice: once when the socket opened, and again whenever its own
box changed and the `ResizeObserver` fired. That reads like a listener and
behaves like a one-shot — **every way a pty moves from the host side leaves the
phone's box untouched**, so nothing fires, and the phone goes on rendering a
window it no longer fits.

What that looks like in the hand is a room drawn wider and taller than the
client that is showing it: the right edge clipped mid-word, and the rows the
program drew for a taller terminal simply absent. Reported here as "cut off at
the bottom — I can no longer see all your agents", **with the tmux status bar
still sitting at the bottom of the screen**. Those two are not in conflict, and
the contradiction is worth writing down because it is the tell: once the pty is
bigger than the client, the bar is the *last line of the stream*, so the bar is
the one thing that survives. What is lost is the body above it and the columns
past the client's width.

So the size is re-stated on every return to the foreground. Same idiom as
`whileVisible` and for the same reason — no clock, no poll, nothing running in
a pocket. A resize to the size it already is costs one small frame and is a
no-op at the pty, and that is the point: it is safe to say *always*, so it is
said unconditionally instead of guessed at.

What this does **not** claim: it is a self-healing path, not a diagnosis of one
particular trigger. The room that prompted it could not be re-measured — by the
time the report was read the phone had detached, and a session with no clients
reports the size its last client held, not a live one. `window-size smallest`
is set on these sessions and was verified set, so a client that reports its
size holds the pane at it. The fix is aimed at the class: whatever moves the
pty, the phone corrects it the moment he looks.

### A dead room says so, and comes back by itself

*FPLAN-0446 r5.* A detached room went on painting its last frame, because that
is the only thing a terminal emulator can do once the bytes stop — and that
frame is **indistinguishable from a quiet room**. The reattach door was a line
*above* the grid, which is a line you can scroll past while the picture below it
goes on looking alive. The picture is what lies, so the correction now sits **on
the picture**: a scrim over the grid, the word `detached`, and the door in the
middle of it. The stale frame stays legible underneath on purpose — it is the
last true thing the room said — but it can never again pass for now. Zoom and
fullscreen keep working through the scrim, because reading that last frame is
exactly when somebody wants it bigger.

Three states hide behind "not attached" and they get three sentences, not one:
opening for the first time (no frame has ever arrived, so no scrim), attached
and then dropped, and never got in at all.

**Why the phone needed liveness of its own.** The other end has it and uses it:
uvicorn pings every 20s and hangs up on a pong that does not come back inside
20s. A browser has no ping API at all — the protocol's own ping/pong is answered
down in the network stack, below JavaScript, and never surfaces — so the room
can be torn down on a clock this side does not share. **The side with liveness
kills the side without it, and the side without it paints the corpse.**

Two lanes, and the phone **feature-detects** which one it is in rather than
coupling to a server version:

- **The real round trip.** One `{"type":"ping"}` per socket; a `{"type":"pong"}`
  back means this host has the lane, and from then on liveness is measured —
  a ping every 10s, dead if no answer inside 30s. Exactly one probe, never a
  retry loop: a host *without* the lane writes a warning line for every unknown
  control frame, and a keepalive that fills somebody else's log is a bug wearing
  a fix's coat.
- **The silence guess**, when nothing answers: **90 seconds** with no bytes at
  all. The number is measured, not felt. An idle agent room is not silent — tmux
  redraws its status bar — but only when that bar's *text* changes, so the gaps
  are long and uneven: benched on a live idle room, the longest gap between
  bytes was **29 seconds** inside a 62-second window. A watchdog at 15s would
  execute a healthy room about once a minute. Three times the worst measured gap
  is the margin, and the cost of being wrong in this direction is one reattach.

Both lanes were proven on the wire against real servers before this shipped: the
running host answers the probe with nothing and **keeps the socket open** (one
warning line, room bytes still flowing), and a host carrying the ping handler
answers `{"type": "pong"}` as a text frame in **2 ms**.

**Coming back is a ladder, not a poll.** Before this, returning to the
foreground was the *only* way a dead room came back — so a socket that died
while he was looking straight at it stayed dead until he backgrounded the app
and returned. Now the retry runs while the screen is up: immediate, then 1s, 3s,
6s, 12s, 30s, and then it **stops and says it stopped**, because a room that has
refused six times running is gone rather than slow, and the honest answer to
gone is a button rather than a wheel that turns forever. Looking away and back
resets the count; the button always works.

The rungs exist because **retrying is not free**. These rooms are opened
`window-size smallest`, so every attach drags the desk's window down to the
phone's columns and bills the other end for a full repaint — 5392 bytes for a
one-column change, benched. Three cuts fell out of the same measurement: the
foreground edge no longer opens sockets on its own (one lane decides, and it is
watching that same event), a handshake already in flight is never overtaken by a
second one, and a socket that came back while a rung was ticking stands the rung
down.

Nothing here runs in a pocket. The watchdog stops when the screen goes away and
starts again — with the clock reset — when he looks, because the question it
asks is how long the room has been quiet *while somebody was watching it*.

**An ended room stays ended, and the ladder is exactly why that needed saying.**
A room that reconnects by itself can undo the operator's own gesture: @api
attaches with `new-session -A` — attach-or-*create* — so a retry into a room
that `end room` just killed does not fail. It builds a new empty session wearing
the dead room's name, and the phone would quietly resurrect the thing he just
ended (*"an ended room stays dead until I resume it"*, Patrick, 08-12). This was
survivable while a detached sheet merely sat there; it stopped being survivable
the moment the sheet learned to retry. So the client now goes when the room
goes: the chip fires on the **machine's answer**, never on the request leaving,
and a kill that was refused leaves the room alive and the tab open. Only that
tab — `end room` ends the *agent's* session, and the branch's shell
(`baud-shell-*`) is a different one that survives it, so closing more would be
this face inventing an outcome the verb never had. The sheet itself stays open,
because the chip's sentence is the only confirmation the gesture landed.

### Git rides the row it belongs to

*DPLAN-0303 phase 2, mock approved 2026-08-17.* The files screen paints status
onto the listing it already had: **a changed file is painted, never moved, never
grouped, never lifted out into a second screen.** The one row this adds is a file
git says is *gone* — absence you can see, in the place the file used to sit. A
directory row wears a dot when anything beneath it changed, so a level points at
where the next tap goes instead of making you open folders one by one to find
out.

**The whole vocabulary, not half of it** (Patrick, 2026-08-17: *"git activity,
green new, red deleted, amber edited, just like git works on vscode"*, and
*"changes dont act different than git"*). The rows lane carries git's own
two-column code per path and untracked files **by name**, so the screen reads the
status instead of inferring one — and it reads it through the same mapping the
git app's file rows use. One mapping, one set of colours, so a file cannot read
as *new* here and *modified* one screen along.

That mapping lives in exactly one file, and its precedence is deliberate and not
alphabetical: **deleted wins** (a file that is gone is the one status where
acting on the row is impossible, so it must never hide behind a second letter),
then untracked (`??`, which has no columns and never appears beside anything),
then added **from the index column only**, then everything else is modified —
renames, copies, type changes, unmerged pairs, and any code nobody anticipated.
A row is never dropped for wearing a letter this face has not met. @api sends the
code **raw and unstripped** for exactly this reason: `A ` and ` M` are different
answers that collapse into one the moment either is trimmed, and in their words,
*"a letter invented here would be a second vocabulary for a fact git has already
stated"*.

### One gear, two owners' files

The header gear used to open the interface panel with @memory's dials bolted
underneath it — two owners' config behind one door labelled *interface*
(Patrick's ruling, and the reason for this round). A second gear is how an app
ends up with two places called settings, so the gear opens **one** surface and
the sections sit inside it: a sectioned dialog on the desk, a list of rows on the
phone. A thumb navigates a screen at a time and a pointer does not need to.

**One implementation, two placements.** `InterfaceSettings` now exports the rows
(`InterfaceControls`) and the rows wearing their own scrim and title bar — the
desk mounts the controls inside a dialog that already carries chrome, the phone
mounts the whole panel on top of its own. A title bar drawn twice is the only
thing that split exists to prevent, and there is still exactly one implementation
of startup agent, poll cadence, bell and hook sounds, and one of the memory
dials.

The phone's settings screen exists because this face gained a preference the desk
does not have: **terminal scroll speed**, a thumb's problem. The knob scales the
pan acceleration the terminal already used, so `3` stopped being the answer and
became the baseline the percentage is a percentage *of* — an absent key leaves
the file computing exactly what it computed before the knob existed. A desktop
control for the same key is not refused, it is simply not that round's; the field
is on the shared document precisely so the desk can grow one without a migration.

### The startup seat, and why it needed a different store

Patrick, 2026-08-17: *"In baud settings I have devpulse set as the default
startup agent. On desktop when I open baud, devpulse is there waiting… Phone does
not do this — when I refresh, devpulse doesn't reload/seat."*

The seat spends **one shot per page load**, and the store is the entire
difference between the two faces. The desk spends its shot in `sessionStorage`
because its *app run* outlives a React remount — `npm run tauri dev` **is** the
operator's seat, so every frontend save hot-reloads `App`, and a ref-held guard
would re-arm and resurrect a room the operator just ended. None of that is true
here: the phone ships a built bundle with no HMR, and its refresh is a **tab
reload**, which `sessionStorage` deliberately survives. Borrowing the desk's
store would have armed the shot exactly once per tab, ever, and left the second
refresh in precisely the state this round exists to fix. Module scope dies with
the page load, which is what *once per open, every open* actually means in a
browser.

It also needed a second flag, and finding out why is the useful part. `scope` is
`"read"` in three unrelated situations — a genuinely read-scoped token, an answer
that failed, and **the first frame of every returning arrival**, before `whoami`
has been asked. Every other consumer is happy with that conflation, because for a
verb chip all three mean the same safe thing. The seat is the one consumer that
must tell them apart, and it is not a race that *sometimes* happens: child
effects run before the parent's, so the fleet is asked for first, and `/v1/fleet`
shells out to `baud --snapshot` without awaiting — it holds the event loop for
the whole read, so the fleet **always** lands first. Gating the seat on `scope`
alone would have made Patrick's own case fail every time.

### The feed learned to clear

Patrick, 2026-08-17: *"notification has no clear button"* — the desktop bell has
one and the phone's feed did not. It is the desk's model exactly: a **cleared-up
to** timestamp held by the face, keyed per project, and everything at or older
than it stops rendering. **Display only** — the feed file is never touched, BAUD
is a reader and ai_mail is the feed's only writer, so there is no host call here
to make.

**Two markers, not one.** *Read* moves by itself when the screen closes;
*cleared* only ever moves when the operator taps clear, and it is the one that
stops an event rendering at all. They live together one level up, beside the
unread count, because the **badge** has to obey the cursor too: a badge counting
three events over a screen that shows none is the phone telling two stories about
one feed. And the button is **absent** rather than disabled when there is nothing
to clear — this face's own rule, because a disabled button on touch has no hover,
no title and no answer.

## Versions and releases

BAUD is versioned with semantic versioning. The current version is **0.2.1**,
declared in three files that must always agree — change one, change all three
(and `Cargo.lock` and `package-lock.json` record the same number, because CI
builds `--locked`):

```
app/package.json                  "version": "0.2.1"
app/src-tauri/Cargo.toml          version = "0.2.1"
app/src-tauri/tauri.conf.json     "version": "0.2.1"   <- what the built binary reports
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
`v0.2.1`, and pushing that tag is the whole ceremony — `.github/workflows/release.yml`
does the rest: it runs the test suite, builds with `npm run tauri build` (the
same command the Development section calls the deploy), and publishes a GitHub
release named after the tag with `baud-v<version>-linux-x86_64` and a
`SHA256SUMS.txt` attached. Each release also carries the built phone bundle as
`baud-phone-v<version>.tar.gz`, the servable `dist-phone/` tree, with its sha256 in
the same `SHA256SUMS.txt`, and so does `baud-cli-v<version>-linux-x86_64`, the
headless binary (see *The headless doors*). It tests before it ships on purpose: a tag can be
pointed at any commit, and "it was probably green on main" is not evidence.

@baud has no git write, so @devpulse pushes the tag.

What each release changed, and what is waiting for the next one, is in
[`CHANGELOG.md`](CHANGELOG.md): every row that lands adds its line under Unreleased.

## How it got here

Eleven milestones over three days, 2026-08-09 to 2026-08-11, and the rounds
answered after them:

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
| m13–m16 | the settings arc — chips follow the session not the seat, the memory dials join the interface gear, the dial write that stopped rewriting the whole config, and `baud --snapshot`: the fleet read as a second entry point, one JSON envelope, no window |
| DPLAN-0300 | the phone face — design tokens, the transport seam, the host API, and a real tmux client in a browser |
| the passport round | the avatar door and the opened passport, the manager mark, the sub-agent pulse, and memory settings that write through @memory's own verbs |
| DPLAN-0302 | the wheel, the one-terminal ruling, browsing goes free, the passport reaches the phone, and the pane that stopped asking the poll who it was |
| DPLAN-0303 | the git app as the wheel's fourth layer, git's own vocabulary on the files screen, the birth certificate drawn as a document, the passport/card split, and one gear per face |

Along the way: whole-window zoom, ctrl+click terminal links, slash-command
chips, and the mail-count fix that reads the mailbox instead of the dashboard's
cache.

Milestones 1–12 are committed, and BAUD `v0.1.0` was tagged and released from
`main` on 2026-08-12. The settings arc and the phone face were committed after
it. **@baud commits this repository itself** — the tier arrived with the repo,
and the day-3 arc landed as one narrative commit on 2026-08-16, DPLAN-0303 as
another. Pushing is still Patrick's own keystroke: this tree is committed on his
word and pushed by his hand.
