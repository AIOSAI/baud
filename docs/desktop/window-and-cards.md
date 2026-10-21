# The window and cards

This page covers the desktop window's frame and its cards: the header, footer, zoom and project switcher, what each card shows and which doors it carries, what a launch button types, and the passport an avatar opens.

← [the desktop window](../desktop.md)

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
because that is what a card reads: the branch's passport, not its process, and
a card's avatar **opens** the passport as a document (see *The opened
passport*). Strip order: dispatched first, then interactive, then alphabetical. The strip
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

**A roster card from another project opens its reads, as the phone's card
does.** Every figure opens the same designed screen it opens on a seated card,
with the card's own project named on the read, so a same-named agent in the
seated project is never read in its place. `files` opens the phone's files
screen in a tab rather than the docked tree, because the tree reads under the
seated root. The `⎇ git` count asks for the branch by name and project over the
host relay; a count that cannot be had shows `n/a` (hover says why), never `0`,
which would read as clean. `watch`, `?`, `❯_` and the launch door work from
anywhere: @prax scopes a watch by itself, and a help or plain shell opens in
the branch's own directory. An amber project tag names its tree.

**Only the gear stays fenced.** The settings panel's memory dials write by
branch name alone, so on a foreign card they would edit the seated project's
same-named agent. The gear is drawn dashed and disabled, and a line under the
card's head says so in words — *`<name>` lives in `<project>`: read it, watch
it, attach it from here. Only the settings gear stays behind: its memory dials
name no project.* — because a tooltip on a disabled button is not a reason
anyone sees.

- **Lamp** — amber pulse: dispatched (`.ai_mail.local/.dispatch.lock` names a live pid).
  Steady green: interactive (a live claude with no `-p`/`--print` has its cwd
  inside the branch). Dim: neither.
- **Avatar** — the agent's initials in a disc, and the door to its passport.
  A fleet of seventeen is scanned by shape before it is read by name, on the
  desk as on the phone's wheel.
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
  colour**: a manager's disc is ringed blue, explicitly not red, because red is
  this app's alarm colour and ownership is not an alarm.
  The card carries the class twice, once in a glyph and once in a colour,
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
  The pulse animates the disc's fill rather than a halo around it: a 9px lamp
  *is* its glow, but a 26px disc whose border and initials are already solid
  red drowns a 35%-alpha halo, which reads as a solid red with no flash. Under `prefers-reduced-motion` the fill is
  held rather than pulsed: motion off, state kept, and kept in a form that can
  still be read.
  Sub-agents never appear in the process table (they run inside the
  parent claude), so the count comes off disk: async agents by the freshness of
  their own `subagents/agent-<id>.jsonl` (180-second window), blocking agents by
  `Agent`/`Task` spawn calls with no matching result in the transcript tail.
  Only transcripts written in the last 15 minutes are consulted. That freshness
  window is why a finished agent can hold the count up for a few minutes — the
  number is honest about what the files say, not about what is still breathing.
- **`?`** — opens a help terminal for this branch (see [Help terminals](rooms.md#the-workbench)).
- **Gear** — opens this branch's settings panel (see [Settings](settings.md)).
  Fenced on a roster card from another project (see above).
- **Figures** — every number is a door to the phone's designed screen for it,
  opened in a workbench tab (one tab per agent and door; a re-click brings it
  forward). `mail` and `open` are counted live from `.ai_mail.local/inbox.json`
  and open the inbox screen, newest first, a message opening to its full text;
  `plans` comes from `DASHBOARD.local.json` and opens the plans screen; `todos`
  comes from the dashboard too and opens the memory screen on its todos tab;
  `⎇ git` is a count of uncommitted tracked files and opens the git app on this
  branch's changes. Each screen's `‹ card` at its floor closes the tab. The raw
  files stay one `files` click away. The dashboard's summary line is
  deliberately not on the card — it restated the same figures.
- **Age** — `updated <age>`, from the dashboard's `last_updated`, styled stale
  when it gets old.
- **Buttons** — `files` docks the branch's file tree on a seated card, and
  opens the files screen in a tab on a roster card; a file picked there opens
  in the same tab, and its `‹ folder` returns to the folder. `❯_` opens a plain
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
are set in the branch's own settings file (see [Settings](settings.md)).

**That line is the terminal slot.** BAUD is terminal-agnostic: AIPass is the
backend that does the work, BAUD is the face that makes it clickable, and the
terminal is a component wired into it — claude in the slot, chosen the way a
model is chosen. Everything Claude-specific about a launch lives on this one line; nothing
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
and the commons feed, because they belong to the agent that runs them. They
use the same doors and tab ids as the header's traffic lights, so a monitor
opened from a passport *is* that tab, and closing it from the tab bar leaves
the toggle honest.

Every page is read and nothing is owned: these are @spawn's and the agent's own
files, and a read that fails prints the refusal in the file's own words rather
than drawing an empty document that would read as an agent with nothing to say.
A passport reached from another project's roster card is fenced like every other
read and says so.

**The document follows the poll.** Its row is looked up live on every render
from the seated snapshot, falling back to the roster sweep, and matched on name
*and* project — a room name carries its project scope, and eleven projects share
a naming convention. The click-time snapshot is kept only for a branch that
leaves both lists mid-read. A card frozen at click could flash red for four
running sub-agents while its passport read "none running"; a view that shows
live numbers has to read them live.
