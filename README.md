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
That tree is BAUD's **anchor**; the header's project switcher can then seat
the view in any other project (see The project switcher below).
Rebuild the release binary after code changes: `cd app && npm run tauri build`.

## The window

One column, no page scroll: header totals (citizens / dispatched /
interactive / unread mail / plans), the fleet strip, the operator terminal
(the only element that flexes), and a footer with the resolved root and
poll status. The fleet re-scans every 5 seconds.

The header's zoom chip (`− 100% +`) scales the whole window, terminal
included — browser-style `ctrl +` / `ctrl -` / `ctrl 0` and ctrl+scroll
work too, even with the terminal focused (zoom keys belong to the app, not
the shell). The level persists across restarts; clicking the percentage
resets it.

The **camera button** beside it takes a screenshot without leaving the
conversation: one click opens the compositor's own picker (region, window,
or whole screen — the XDG portal's interactive mode, the one door Wayland
allows anyone), the capture is copied to `~/Pictures/BAUD/`, and its path
is typed straight into the chat box — Claude reads images by path, so the
operator just presses Enter. Amber while the picker is open, red when a
capture failed or was cancelled (the tooltip says why). BAUD ships its own
portal client — no external screenshot binaries, which is the
self-contained doctrine for going cross-platform later.

**Dropping a file** anywhere on the window does the same thing from the
other direction: its path (quoted if it needs it) lands in the chat box,
exactly what dropping onto a real terminal does. Screenshots taken outside
BAUD drag in; screenshots taken inside print themselves.

The **bell** between them is a placeholder on purpose — the visible
reminder that BAUD-native notifications are planned. It renders, it
explains itself on hover, it does nothing yet.

The **prax toggle** beside the totals is a traffic light for prax mission
control: click it and it turns green while a live, read-only view of every
branch's activity (`drone @prax monitor run`) opens as a workbench tab;
click again and the light goes red as the monitor dies with its tab. Any
door closes it — the toggle, the tab's ✕, the pane's corner button, or the
monitor process ending on its own — and the light follows, because the
light IS the tab's existence, not a second piece of state.

Monitor panes are **tier-0 aux panes** (the first of the auxiliary-pane
tiers): a pane of glass, not a seat. No keyboard reaches them — xterm's
stdin is disabled in the pane, and the backend refuses `pty_write` for any
read-only session no matter who asks, which is the honest enforcement
(filtering what can be typed is theater; wiring no stdin at all is a
fact). The one operator terminal stays the only seat of agency. The
monitor command itself is backend-composed from a fixed shape — the
frontend picks a target, never writes a command line.

### The project switcher

The chip beside the wordmark names the project the fleet view is **seated**
in; clicking it lists every project BAUD discovered and reseats on click —
no restart, no second window.

A **project** is a directory sealed by a `<NAME>_REGISTRY.json` in its root
— the filename stem is the canonical name, and the registry's own
`branches[].path` entries name the fleet dir (no layout guessing). BAUD's
census: the anchor tree it launched from, `projects/*` nested inside it,
and the anchor's sibling directories. A seal with no branch paths, or a
legacy flat layout whose branches sit at the project root, simply never
makes the menu.

The discovery is **backend-owned**: the frontend picks a NAME from the
backend's own census — there is deliberately no way to hand BAUD a path
from the webview, so seating in a project never weakens the read fence, it
only moves it. Reseating moves the whole read surface at once — fleet scan,
file fence, new shells — and empties the reading room (open tabs point
where the fence now rightly refuses to read). The terminal is untouched: an
attached room keeps running, and the scratch shell is the operator's own.

### Cards

One citizen, one card. The card IS the report — nothing hides in tooltips:

- **Lamp** — the ground truth of activity. Amber pulse = dispatched (the
  machine is churning on a wake; `.ai_mail.local/.dispatch.lock` exists).
  Steady green = interactive (a live human-driven claude has its cwd in
  this branch — found by walking `/proc`, `-p`/`--print` runs excluded).
  Dim = idle.
- **Sub badge** — an amber `N sub` in the header while the branch's live
  session has sub-agents out. Sub-agents are invisible to the process
  table (they run *inside* the parent claude), so the count comes from the
  session transcript: spawn calls still waiting on their results. Worn
  only when N > 0.
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
  with no transcripts at all shows a single `▸ claude`. When the room holds
  a live session, both collapse into a single `▸ attach`. `files` docks
  the branch's file tree. `watch` opens a tier-0 monitor pane scoped to
  this branch (`drone @prax monitor run <branch>`) — same no-keyboard
  doctrine as the header lights, one card wide. Re-clicking brings the
  open pane forward; closing is the tab's ✕ or the pane's corner.
  *Known gap, honest:* prax currently accepts the branch argument but does
  not filter by it yet — every watch pane shows all-branch output until
  @prax lands the scoping (dispatched 2026-08-11); BAUD's side of the
  contract is already the documented one.

Strip order: dispatched first, then interactive, then alphabetical.

### Rooms

Every agent's session lives in a persistent tmux session — its **room**
(`baud-<branch>`; in a seated non-anchor project `baud-<project>-<branch>`,
so two projects' same-named branches can never attach to each other's
sessions), owned by the tmux server, not by this window. BAUD's terminal is
only a window INTO the room:

- **Open a card** — attach (`tmux new-session -A`; the room is created on
  first visit, seated in the branch dir, mouse scrolling on).
- **Switch cards** — detach one room, attach the next. The agent you left
  keeps working; nothing is cancelled mid-turn.
- **Close BAUD** — every room just loses its window. Sessions, monitors,
  and builds keep running.
- **Come back** — attach again: same process, same scrollback. No respawn
  means no transcript forks and no resume roulette.
- **`⇠ detach` / `✕ end room`** — the terminal's corner buttons in a room.
  Ending the room (`tmux kill-session`) is the ONE way a session actually
  dies. The scratch shell (no card) keeps its plain `✕ kill`.

The staged claude command is typed only where it lands at a prompt: into a
room just created, or one with no live claude. Attaching to a live claude
types nothing — your click lands you mid-conversation, exactly as left.

A card whose room exists but holds nothing live wears a quiet `room` tag;
a live one shows `live` as before.

### The reading room

Every number on a card is a door: clicking a figure opens the file the
number came from (inbox, dashboard, todos) in a read-only CodeMirror pane,
and the `files` button docks a lazy directory tree for browsing anything
else in the branch. Open files live in tabs beside the terminal — the
terminal never unmounts, hidden panes are just display-hidden, so claude
keeps streaming underneath while you read.

**Ctrl+click in the terminal** is a door too, IDE-style, on two layers.
Claude wraps its file citations in OSC 8 hyperlinks (`file://` URIs) —
BAUD's link handler claims those, so they underline on hover and open in a
reading-room tab instead of escaping to the OS file manager (xterm's
default drops non-http links entirely: no hover, no click). Plain-text
paths in any output (grep, pytest, absolute, repo-relative, `path:123`
citations) get the same treatment through a resolver: a mention only
becomes a link if it names a real file inside the fence (seated room's
branch dir first, then the seated project's root), so a dead path never
underlines.
Both open jumped to the cited line. URLs open in the system browser. Plain
clicks stay tmux's — only the ctrl-chord activates, so claude cites
`file.py:42`, one ctrl+click, and you're reading it beside the live
terminal.

The changes badge opens the same kind of tab holding the branch's full
uncommitted diff in patch syntax. Diff tabs refetch every time they come
back to the front (a diff goes stale the moment the agent keeps working);
file tabs load once. Everything is read-only and fenced: the backend
canonicalizes every requested path and refuses anything outside the seated
project's root, viewers cap at 512 KB, binaries are refused. There are no
write commands in the codebase — committing stays in the terminal, through
drone.

### Terminal

The operator's shell, centre stage — a real PTY running the user's own
shell with their own privileges. A `✕ kill` button sits in the corner
while a shell is live: same SIGHUP closing a terminal window sends, so a
running claude stays resumable from its transcript.

When the attached room holds a live claude, **slash-command chips** join
the corner buttons: `/memo` (quick memory update — banks the conversation
so far, keeps going), `/prep` (session wrap-up — memories saved, plans
reconciled, close safely after), `/compact` (compress context and
continue). One click types and submits the command; the hover text
teaches what each ritual is for — slash commands are invisible culture
otherwise, and a new operator has no way to discover `/prep` exists.
`/clear` is deliberately NOT a button: the one that discards a
conversation keeps its typing friction. The chips only render where a
chat box exists to receive them — never into a bare shell prompt.

## The seat model (read this before extending)

BAUD has **one PTY — one seat**, but since rooms (m6) the seat is a
*window*, not a cage: a card click SIGHUPs the pty's process group, and
for a room client that teardown is a **detach by construction** — the
agent lives in the tmux server's process tree and keeps working. Rooms run
in parallel; attention is singular. One terminal hops between agents
because every room keeps its own scrollback and process alive behind the
curtain.

Consequences worth knowing:

- Agents in **rooms are immortal to card-clicking** — only the `✕ end
  room` button (`tmux kill-session`) actually ends one.
- The **scratch shell** (no card) is the one mortal seat: its `✕ kill` is
  a real SIGHUP kill, same as closing a terminal window — a claude running
  there stays resumable from its transcript.
- There is **no "max agents" constant anywhere in the code**. N rooms + 1
  seat is pure arithmetic; open more rooms and the fleet grows.

(Historical note: before m6 the seat itself was the cage — every card
click killed the previous agent. This section described that model long
after rooms shipped; truth restored 2026-08-10, the same night @hooks
found the identical disease in its own README.)

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
| projects | sealed `<NAME>_REGISTRY.json` census: the anchor, its `projects/*`, its siblings — fleet dir from the registry's own `branches[].path` |
| files / viewer | `list_dir` + `read_file_text`, fenced to the seated project's root |
| changes badge + diff | the installed `git` binary, `diff HEAD --relative` scoped to the branch dir — the only git verb BAUD ever runs |
| terminal links | claude's OSC 8 `file://` hyperlinks (claimed by the app's link handler) + plain-text paths, both through the fenced `resolve_paths` command (seated branch dir, then root — only real files link); URLs through the opener plugin's url-only grant, never reveal-in-dir |
| room | `tmux list-sessions` (one call per snapshot) — the only tmux verbs BAUD runs are `new-session -A`, `list-sessions`, `kill-session` on the end-room click, and `set-option mouse on` |
| sub badge | the session transcript's tail: `Agent`/`Task` spawn calls with no result yet, summed over transcripts active in the last 15 min — sub-agents never appear in `/proc`, they run inside the parent claude |
| camera | the XDG Desktop Portal (`org.freedesktop.portal.Screenshot`, interactive) via BAUD's own client — the capture is copied to `~/Pictures/BAUD/` and its path typed into the chat box, never submitted |
| dropped files | the webview's drag-drop event (real filesystem paths) — quoted and typed into the chat box, Enter stays the operator's |

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
