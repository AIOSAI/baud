# The window and cards

This page covers the desktop window's frame and its cards: the header, footer, zoom and project switcher, the wheel and its round cards, the passport a card opens and the doors it carries, and what a launch button types.

← [the desktop window](../desktop.md)

## The window

One column, no page scroll: header, the wheel, workbench (the only element
that flexes), footer.

**Header, left to right.** The `BAUD` wordmark and the project chip; then the
totals (citizens, dispatched, interactive, unread mail, plans, changes), the
`❯_` terminal button, two monitor traffic lights (`prax`, `commons`), the
camera, the bell, BAUD's own settings gear, and the zoom chip.

**`❯_` opens a working shell in a tab**, seated at the project root — the
global one. It follows the project chip: reseat the view and the next click
opens the new root, and it stays disabled until a snapshot names that root
rather than guess. Every opened passport carries the same button seated in its
own branch directory instead. These are plain shells with nothing typed into
them — not rooms, not agent seats — and they are keyed by directory, so a
re-click brings the open one forward and a project shell can never collide with
a branch's.

**`changes` is not the sum of the cards**, and the difference is the point. A
branch's git count asks `diff HEAD` about its own subtree, which sees tracked
files only; the header asks `git status --porcelain -uall` about the whole
seated repository, so files git has never seen — a brand-new module, the most
interesting change in a tree — are counted there and nowhere else. Ignored paths
(`target/`, `node_modules/`, `dist/`) never reach it. A failed read shows `—`,
never `0`: a zero would claim the tree is clean when we simply do not know.

**Footer.** The resolved project root, and the poll status — how long ago the
last snapshot landed and the current cadence.

The fleet polls every 5 seconds by default; the interface settings can move that
to 2, 10 or 30 seconds, and the change takes effect on the spot. The census
behind the `live` and `dispatched` layers polls at the same cadence. Git counts
keep their own slower lanes (see *The wheel* and *The doors*).

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

The menu's last row, `+ new project`, opens the phone's new-project sheet: a
name, a template (`empty` or `python`), create. The host makes the project; the
window then seats it by the census name the host returns, never the typed name,
and launches the new manager through the same door its passport's launch button
uses, which for a newborn is `fresh`. A seat that fails after the project was
made says so in the fault banner.

## The wheel

The fleet sits under the header as the phone's own wheel: `App.tsx` mounts
`phone/FleetWheel.tsx` inside a `baud-wheel-desktop` box. One component, two
faces, so a card, a layer and a refusal read the same on the desk and in a
pocket. The wheel's mechanics — the scroll-snap rail, the centre notch, the
two-touch open, the layers — are on [the phone's wheel page](../phone/wheel.md);
what follows is what the desk feeds it and what it does with an open.

**Five layers decide what is on show**, one pip each: `current project` (the
seated project's own fleet, every branch it has), `live`, `dispatched`, `apps`
and `monitor`. `live` and `dispatched` are census-wide: they sweep every
project BAUD discovered and show only agents actually working, so two managers
in two trees sit one layer apart without the project chip moving. That matters
because the terminal outlives a project switch by design — the seat and the
conversation are independent, and the roster keeps it that way. Working means a
live interactive claude or a dispatch in flight; an idle room is a place, not an
agent at work, and listing it would bury the cards that matter. The sweep costs
one `/proc` pass and one tmux round-trip for all projects — the same two storms
a single snapshot already pays — and polls only while `live` or `dispatched` is
showing. A census that cannot be read is a refusal line on the wheel, never an
empty layer: *could not look* and *nobody is working* are different facts.

**A round card carries state, one count and a name.** The disc holds the
agent's initials; a dot gives its state (dispatched, live, idle — dispatched
outranks live); one badge sums what is waiting (mail, opened mail, plans, todos
and the git count); the name sits under the disc, and a card from another
project names that project under the name. A fleet of seventeen is scanned by
shape before it is read by name. Everything else lives in the opened passport,
because a rail of dense cards is a field of misclicks.

- **Manager** — a disc ringed blue on citizens whose passport says
  `identity.citizen_class` is `manager`: a project's first agent and its owner,
  the only class holding git write, the feedback channel to @devpulse, and
  watchdog. Blue, explicitly not red, because red is this app's alarm colour and
  ownership is not an alarm. Read from the passport itself — no passport,
  unreadable, malformed, or any other class all read as "not a manager",
  because an ownership mark is a claim BAUD only makes when the file makes it.
  The snapshot carries `citizen_class` verbatim beside the boolean, so a class
  AIPass adds later needs no new plumbing to reach the passport page.
- **Sub-agents** — the disc pulses red while sub-agents run inside the branch's
  session: work happening inside a session that nothing else on screen reports.
  Under `prefers-reduced-motion` the fill is held rather than pulsed: motion
  off, state kept. Sub-agents never appear in the process table (they run
  inside the parent claude), so the count comes off disk: async agents by the
  freshness of their own `subagents/agent-<id>.jsonl` (180-second window),
  blocking agents by `Agent`/`Task` spawn calls with no matching result in the
  transcript tail. Only transcripts written in the last 15 minutes are
  consulted. That freshness window is why a finished agent can hold the pulse up
  for a few minutes — the mark is honest about what the files say, not about
  what is still breathing.

**What feeds the cards.** The git term in each badge comes from the phone's
slow sweep (`useGitSweep`): one branch per tick, round the fleet, and a branch
the sweep has not reached adds nothing, so the badge can undercount but never
invents. The apps layer's GIT card wears the repository count (`useRepoCount`),
addressed by the seated project's manager, so it does not move with the wheel.
The monitor layer's machine faces (`useMachineVitals`) poll only while that
layer shows.

**Opening a card.** A click on an off-centre card centres it and opens nothing;
a click on the centred card opens it. An agent opens its passport (see *The
opened passport*); FILES docks the file tree on the left at the project root
and a second open closes it; GIT and BACKUP open their own workbench tab, and
every card on the monitor layer the MACHINE tab (see [the apps](apps.md)).

**Keys and the mouse wheel.** With a mouse or trackpad attached the wheel takes
focus: `←`/`→` centre the previous or next card, `↑`/`↓` switch layer (down is
the next layer), `Enter` opens the centred card. A vertical mouse-wheel turn
switches the layer, `shift`+wheel steps one card, and a sideways trackpad pan is
left to the rail's own scroll-snap. One step per gesture, so a flung trackpad
cannot ride through the stack. The pips are buttons, and a mouse drag switches
layers as a finger does. The bindings and their detection are on
[the phone's wheel page](../phone/wheel.md#desktop-input).

**Size.** The phone's numbers, unchanged: a 64px card, a 44px avatar. The wrap is
capped at 960px and centred, so a wide window gets a centred wheel rather than a
longer one. Under the cap the rail's inline padding is `calc(50% - 32px)`,
because the phone's `50vw` measures the window, not the wrap, and would centre
the snap off the notch. A focused wheel wears an outline in the layer's accent.

## The opened passport

Opening an agent's card opens that agent as a **document**: issuer, document
type, holder — `AIPASS`, `AGENT PASSPORT`, the name — then the doors, then the
pages. It is a modal rather than a workbench tab, and the distinction is the
reasoning: the workbench is where the operator *works*, holding a terminal and
the files kept open beside it, while a passport is consulted and dismissed.
Escape closes it, because the settings panels already taught that gesture.

### The doors

`PassportDoors.tsx` renders the agent's doors above the identity page. Every
door opens something in the window behind the scrim, so pressing one closes the
passport first.

- **Badge** — `dispatched` (`.ai_mail.local/.dispatch.lock` names a live pid),
  `live` (a live claude with no `-p`/`--print` has its cwd inside the branch),
  or a quiet `room` when a tmux room exists with nothing live in it. A trailing
  `⧉` means the live session is one BAUD did not create; hovering names it.
- **Provider** — a codex agent names its provider in plain text beside the badge.
- **Sub badge** — amber `N sub` while sub-agents are running inside the
  branch's session: the number behind the wheel's red pulse.
- **Project tag** — an agent from another project gets an amber tag naming its
  tree, and the away note under the head (see below).
- **`?`** — opens a help terminal for this branch (see [Help terminals](rooms.md#the-workbench)).
- **Gear** — opens this branch's settings panel (see [Settings](settings.md)).
  Fenced for an agent from another project (see below).
- **Figures** — every number is a door to the phone's designed screen for it,
  opened in a workbench tab (one tab per agent and door; a re-click brings it
  forward). `mail` and `open` are counted live from `.ai_mail.local/inbox.json`
  and open the inbox screen, newest first, a message opening to its full text;
  `plans` comes from `DASHBOARD.local.json` and opens the plans screen; `todos`
  comes from the dashboard too and opens the memory screen on its todos tab;
  `⎇ git` is a count of uncommitted tracked files and opens the git app on this
  branch's changes. Each screen's `‹ card` at its floor closes the tab. The raw
  files stay one `files` click away. The dashboard's summary line is
  deliberately not shown — it restates the same figures.
- **Age** — `updated <age>`, from the dashboard's `last_updated`, styled stale
  when it gets old.
- **Buttons** — `files` docks the branch's file tree for a seated agent, and
  opens the files screen in a tab for one from another project; a file picked
  there opens in the same tab, and its `‹ folder` returns to the folder.
  `watch` opens a read-only monitor pane scoped to this branch. `❯_` opens a
  plain working shell in a tab, already seated in the branch directory — the
  same door the header's `❯_` opens at the project root. Then the launch door:
  a branch with a live interactive claude in a session — its own room, or one
  BAUD did not create — shows a single `▸ attach`, never a second claude in the
  same branch; otherwise `▸ resume` (when there is anything to resume) beside
  `fresh`, or a single `▸ claude` when the branch has no transcripts at all. A
  dispatched branch shows `⏳ working` in resume's place, and it opens the watch
  pane: resuming a dispatched session steals its background-task state and
  kills the job, while `fresh` starts a new session id and steals nothing.

The `?`, the gear and the buttons render only for citizens — a directory
without `.trinity/passport.json` gets a card, but no doors.

**The git count polls only while a passport is open**, for that one agent,
every 15 seconds (`GIT_POLL_MS`), which is not configurable — a git subprocess
per tick is real work and uncommitted-file counts do not move second to second.
For an agent from another project, a count still being asked shows `—` and one
that cannot be had shows `n/a` (hover says why), never `0`, which would read as
clean.

**An agent from another project opens its reads, as the phone's card does.**
Every figure opens the same designed screen it opens for a seated agent, with
the agent's own project named on the read, so a same-named agent in the seated
project is never read in its place. `files` opens the phone's files screen in a
tab rather than the docked tree, because the tree reads under the seated root.
The `⎇ git` count asks for the branch by name and project over the host relay.
`watch`, `?`, `❯_` and the launch door work from anywhere: @prax scopes a watch
by itself, and a help or plain shell opens in the branch's own directory.

**Only the gear stays fenced.** The settings panel's memory dials write by
branch name alone, so for a foreign agent they would edit the seated project's
same-named agent. The gear is drawn dashed and disabled, and a line under the
doors' head says so in words — *`<name>` lives in `<project>`: read it, watch
it, attach it from here. Only the settings gear stays behind: its memory dials
name no project.* — because a tooltip on a disabled button is not a reason
anyone sees.

### What a launch button types

One visible line, on the click:

```
cd '<branch dir>' && command claude --permission-mode bypassPermissions [-c | --resume <id>]
cd '<branch dir>' && command codex --dangerously-bypass-approvals-and-sandbox [resume <id>]
```

The agent's `provider` picks the line. A codex branch resumes only through its
session pointer: BAUD scans no Codex transcripts, so with no pointer it starts
fresh.

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

### The pages

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
A passport opened from another project's card is fenced like every other read
and says so.

**The document follows the poll.** Its row is looked up live on every render
from the seated snapshot, falling back to the census roster, and matched on name
*and* project — a room name carries its project scope, and eleven projects share
a naming convention. The open-time row is kept only for a branch that leaves
both lists mid-read. A passport frozen at open could show four running
sub-agents on the wheel while its page read "none running"; a view that shows
live numbers has to read them live — the doors included.
