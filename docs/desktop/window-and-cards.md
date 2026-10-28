# The window and cards

This page covers the desktop window's frame and its cards: the header, footer, zoom and project switcher, the wheel and its round cards, the agent card the wheel opens and its passport, and what a launch button types.

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
rather than guess. Every opened card's `shell` door opens the same kind of
shell, seated in its own branch directory instead. These are plain shells with nothing typed into
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
and launches the new manager through the same door its card's launch door
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
shape before it is read by name. Everything else lives in the opened card,
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
a click on the centred card opens it. An agent opens its card (see *The
opened card*); FILES docks the file tree on the left at the project root
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

**Size.** The desktop renders the wheel at 1.5x through one variable:
every card dimension in `phone.css` is `calc(<px> * var(--wheel-scale, 1))`, and
`.baud-wheel-desktop` sets `--wheel-scale: 1.5`, so a card is 96px with a 66px
avatar while the phone, which never sets it, computes its own numbers. No CSS
`zoom`: the centring math measures rendered boxes, and the window zoom is the
webview's own. The wrap is capped at 1440px and centred, so a wide window gets a
centred wheel rather than a longer one. Under the cap the rail's inline padding
is `calc(50% - 32px * var(--wheel-scale))`, half a card, because the phone's
`50vw` measures the window, not the wrap, and would centre the snap off the
notch. A focused wheel wears an outline in the layer's accent.

## The opened card

Opening an agent on the wheel opens the phone's agent card, `AgentSheet.tsx`,
the same component the phone draws: one card, two faces. Every door, line and
rule on it is described once, on [the phone's card page](../phone/card.md);
this section covers what the desktop wires behind it.

**It is a modal, not a workbench tab.** The workbench is where the operator
*works*, holding a terminal and the files kept open beside it, while a card is
consulted and dismissed. A click on the scrim closes it, and so does Escape,
because the settings panels already taught that gesture. The card sits centred
on the window, 460px wide (`min(92vw, 460px)`, up to 86% of the window's
height) through the `.baud-desk-card` container in `theme.css`; the phone's own
stylesheet is untouched.

**Every door that opens something in the window closes the card first.**

| Door | On the desktop |
| --- | --- |
| the name | the agent's `README.md`, by its absolute path, in a file tab |
| `?` | a help terminal for this branch (see [Help terminals](rooms.md#the-workbench)) |
| gear | this branch's settings panel (see [Settings](settings.md)), fenced for an agent from another project |
| `MAIL`, `PLANS`, `TODOS`, `GIT` | the phone's designed screen in a workbench tab, one tab per agent and door: the inbox, the plans screen, the memory screen on its todos tab, the branch's git changes; each screen's `‹ card` at its floor closes the tab |
| launch doors | the terminal (see *What a launch button types*) |
| `‹ detach` | closes the terminal's client; the room keeps running |
| `files` | docks the branch's file tree for a seated agent; for one from another project, the files screen in a tab, because the tree reads under the seated root |
| `shell` | a plain working shell in a tab, seated in the branch directory, the same kind the header's `❯_` opens at the project root |
| `watch` | a read-only monitor pane scoped to this branch |
| `memory` | the memory screen in a tab |
| `prax`, `commons` | a manager's two monitors, the same tabs as the header's traffic lights, so pressing one whose tab is open closes it |
| `passport` | the phone's passport sheet (below) |
| `wake`, `end room` | the host's verbs, over the relay |

**The room-below line and `‹ detach` follow the terminal.** The terminal
reports the room its client is attached to, by name and project, while that
client is live; the card shows `▸ this room is open in the terminal below` and
offers `‹ detach` in place of the launch doors only when both match. Two
projects can each hold a room for a same-named agent, so a name alone would
claim the wrong one.

**`end room` ends the room through the host**, as on the phone, with the same
confirm. Where the window offers no platform authenticator, the fingerprint
attempt falls through to the plain tap. When the
host confirms the kill, the terminal's client closes if it holds this room, the
room is marked ended under its own project so the startup agent leaves it
closed, and the fleet is polled again; the card stays open to show the answer.
The terminal's own `✕ end room` marks its room the same way, under the project
its attach named.

**The card follows the poll.** Its row is looked up live on every render from
the seated snapshot, falling back to the census roster, and matched on name
*and* project. The open-time row is kept only for a branch that leaves both
lists while open. The card fetches its own git count once per open.

### The passport

The card's `passport` door opens the phone's passport sheet,
`PassportSheet.tsx`: holder disc, name and class, role, purpose, traits, the
issue date, the short passport and branch registration numbers (tap for the
full id), principles, the `MANAGER` and `ADMIN GRANT` stamps, and the records
door. It stands in for the card while open; its `×`, a scrim click or Escape
returns to the card. It reads `<branch>/.trinity/passport.json` and the birth
certificate by name and the card's project, which the desktop sends over the
host relay, so a passport from another project reads its own agent's file.

**The records door** opens the files screen in a tab, floored at the branch's
`artifacts/`, where `birth_certificate.json` is drawn as the certificate it is
rather than as text.

### What a launch button types

One visible line, on the click, built by `launchCommand` in
`src/phone/lib/rooms.ts`, the same line the phone types:

```
cd '<branch dir>' && command claude --permission-mode bypassPermissions [-c | --resume <id>]
cd '<branch dir>' && command codex --dangerously-bypass-approvals-and-sandbox [resume <id>]
cd '<branch dir>' && drone @hooks sessions reclaim @<branch> && sleep 2 && <the resume line>
```

The agent's `provider` picks the line. A codex branch resumes only through its
session pointer: BAUD scans no Codex transcripts, so with no pointer it starts
fresh. The third line is `▸ resume ⚡` on a dispatched agent: resuming onto a
working session would steal its background tasks and kill the job silently, so
the door takes two presses inside four seconds and the line stops the job
first. The startup agent never takes that door; a dispatched startup agent
opens its watch pane instead.

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
