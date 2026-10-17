# The room: the terminal sheet

This page covers the terminal sheet: attaching to a room, the key bar, the room's geometry, scrolling, the standing layout, zoom and fullscreen, selection, the size re-statement and what a streaming room costs. Typing and the keyboard are on [room input](room-input.md); links, photos and a dropped room are on [room delivery](room-delivery.md).

← [the phone face](../phone.md)

### The terminal sheet

**The terminal — attach, not repaint.** Each card carries the desktop's own
launch doors, and pressing one opens a real `xterm.js` client on a WebSocket
(`/v1/room/attach`) whose far end is a PTY running `tmux new-session -A -t
baud-<branch>` — the same command `pty.rs` runs on the desk. Two clients, one
session. Scrollback, colour, cursor position and full-screen programs all work
because nothing is reimplemented. Repaint-polling `capture-pane` would show a
picture of the room that updates; attach gives you the room.

- **A launch IS an attach**, exactly as on the desktop. The modes are
  `resume | fresh` — attach is not a third one — and a room with a live agent
  offers exactly **one** door, structurally: `roomDoors()` returns a
  single-element list for it, so there is no branch where a live room is also
  offered a resume.
- **The double-claude guard is ported, not re-solved.** A command line is typed
  only where it can land at a *prompt*; a room with a live claude has a message
  box instead, so bytes sent there become chat. `rooms.ts` quotes every rule
  back to the desktop line it came from.
- **Attaching needs OPERATE**: an attached room is a shell prompt with the
  operator's credentials at it. Under a read token the doors render **disabled
  with the reason** and **no socket is opened at all** — the refusal is not a
  dimmed button in front of a live connection.
- **Closing is free.** Disconnect sends SIGHUP to the tmux *client* — a detach.
  The session, the agent and the scrollback survive. Ending a room is exactly
  one door (`--end-room`), and nothing in the sheet can reach it.
- **The phone sizes like the real client it is.** FitAddon measures the sheet
  and sends `{"type":"resize","cols","rows"}`. What the room does with that is
  set explicitly — see the geometry section below.
- **The key bar writes real control bytes** (`0x03`, `0x1b`, `\x1b[A`), not key
  names. A stream interprets nothing, so no key-name allowlist is needed (unlike
  `send-keys`, which *interprets* what it is handed). The bar is esc (hold: esc
  esc), tab, ⇧⇥ (`\x1b[Z`), sticky CTRL and ALT, ^C, and ⏎ (hold: `\n`, a newline
  without submit), with the four arrows in a separate row. CTRL and ALT latch on
  a tap and lock on a long-press. Arrows combine modifiers as `1 + alt·2 +
  ctrl·4`. A character Ctrl has no byte for passes through unchanged and keeps
  the latch.
- **xterm runs as a plain stream client:** `convertEol: false`, because a real
  stream carries its own CR; scrollback of 2,000 lines; background `#070a09` and
  foreground `#d6e2dc`; a font stack led by JetBrains Mono, IBM Plex Mono and
  `ui-monospace`.
- **Typing a line and running it are two bytes.** The field writes the literal,
  and `\r` goes separately: nothing on this path can append a newline for you.
- **The attached card is frozen at the moment the door was pressed.** The fleet
  re-polls every ten seconds and hands down a new object each time; depending on
  it would re-run the attach effect per poll, opening a fresh socket and
  **re-typing the launch line into the room**.

**A room opens with two options, and each chained command carries its own
`-t`.** `pty.rs` opens rooms with `tmux new-session -A` and then sets
`mouse on` and `window-size smallest` on that session by name. A chained
`set-option` with no target writes to whatever tmux considers the *current*
session; that is the room only when a client is attached, and not under `-d`.
The explicit `-t` costs nothing and removes a question the code cannot answer.
Test probes must match production's shape: a probe that differs in one switch
(`-d`) inverts the result.

`room_argv()` earns its place: a list of strings can be asserted, a
`CommandBuilder` handed to a pty cannot.

**Geometry — why `smallest`, measured across all three policies.** A tmux status
bar that stacks copies of itself, typed messages arriving mangled, and no scroll
are one bug wearing three costumes: a client whose grid disagrees with the
window. Two clients, one room, and tmux's default `window-size latest` means the
window follows whichever client resized last — so the desk steals the geometry on
its next repaint while the pocket is still holding 72 columns.

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
someone is looking at one. `new-session -A -D`, which detaches the *other*
client on attach, is also correct and one flag, but it kills the desktop's pane
instead of shrinking it, and it needs a change on the host side. Gentler beats
cheaper.

**The attach lane gives its tmux client a controlling terminal.** Under
`latest`, a desk pane attached at 200×30 hands the phone a 200-column window to
render on a 72-column grid, which is text arriving mangled; `smallest` prevents
it. The stacking status bar has a second cause: a tmux client spawned with no
controlling terminal gives `TIOCSWINSZ` no recipient, so the PTY is born 0×0 and
the client falls back to 80×24 *forever* — eighty columns painted into a
46-column screen is the mangling and the staircase both. @api's attach lane
acquires the terminal with `login_tty` and sets an initial winsize before spawn.
The test harness cannot exhibit that bug: its stand-in spawns the client through
`pty.fork()`, which *does* give a controlling terminal.

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
  *text*, and `[<64;38;20M` would land in claude's input box. A room with no
  mouse lane scrolls the local xterm buffer instead and the chip says why.
- **The browser does not get the down-swipe.** Reaching back through history is
  a downward pan, which is exactly the gesture Chrome claims for
  pull-to-refresh. `overscroll-behavior-y: contain` on `html`/`body` kills the
  refresh action without touching ordinary scrolling, and `touch-action: none`
  on the terminal host stops the browser interpreting the pan at all —
  `preventDefault` alone is not enough, because a browser can claim a gesture at
  `touchstart`, before the first move is ever delivered. Taps still fire, so
  focusing the terminal is unaffected.
- **A pan travels 3× the thumb** (`PAN_ACCELERATION`). Tracking the finger
  exactly is right for a document you are reading and wrong for scrollback you
  are reaching *back* through, where the thumb runs out of screen long before
  the history runs out. At 3× one comfortable swipe is about a screenful. A feel
  constant, not a correctness one.
- **The `↑`/`↓` chips are arrow KEYS, labelled `↑key`/`↓key`.** Read as scroll,
  they would stuff a stale prompt into the room's input box, which then rides
  out with the next message, because send ships the *box*, not the field. They
  stay arrows because claude's menus are navigated with arrows and a phone that
  cannot answer a permission prompt is worse than one that cannot scroll. Scroll
  has its own clearly different pair (`▲`/`▼`) to their left, and a gesture.

### The standing screen is the wheel and the room

The standing layout is exactly two things — the rail and the terminal — and
everything that would restate a fact lives where the fact already lives.

**There is no current-agent strip.** All agent info goes in the card. The rail's
dots and badges are the at-a-glance layer, the expanded card is the detail
layer, and a strip between them would be a third copy paying rent in the one
dimension the terminal needs.

**The terminal has no header row.** It would cost a permanent row to say three
things: which room, that the room is attached, and a detach button.

**So the "which room is below" fact lives on the rail itself** — an amber ring
on that agent's card, deliberately *not* the centred card's green. Those are two
different questions ("which card am I looking at" / "which room is below"), and
answering both in one colour would make the wheel say less rather than more.
Browsing away from an attached room with nothing acknowledging it reads as a
flick that failed to switch, so the fact survives — it costs no row, and it
points straight down at the terminal it describes.

**Detach is a door on the card, and only on one card.** The agent whose room is
open offers `‹ detach` and *not* attach — "open this room" is not an offer you
can make about the room already on screen. Every other agent offers attach and no
detach. It is worded away from `end room`, which sits a few lines below it and is
destructive: this one closes a client, and tmux keeps everything.

**The status line appears only for news.** `attached · name` is what a room
looks like when nothing is happening, and a permanent row restating that is
rent. An upload in flight or a dropped socket is news, and news gets a line.

The terminal's screen is about **66% of the viewport, 44 rendered rows** at the
10px default.

**Zoom is real rather than cosmetic.** `A−` / `A+` set the size on the live
terminal, re-measure with FitAddon, and *send the new geometry*. Smaller type
genuinely buys columns and the room follows, because rooms are opened
`window-size smallest`: measured 79×44 → **88×49** on one press, with the resize
frame on the wire and no reattach.

**Fullscreen is a CSS class on the mounted node, never a remount.** The terminal
sheet is keyed by room, so anything that unmounts it closes the socket — a
fullscreen toggle implemented by moving or re-rendering the node would cost the
operator the room every time they pressed it. Entering and leaving fullscreen
produce zero detaches and zero attaches on the wire, keep the terminal's DOM node
identity, and send a resize frame for the new geometry each way. The room stays
typeable in fullscreen, and exiting returns to the layout underneath with the
rail at the same scroll position.

### Selection

**Selection on a touch screen** rests on four mechanisms: the forged shift-drag,
the second-finger guard, the `contextmenu` prevent, and the ResizeObserver hold —
a fit mid-drag drops the selection, so a drag holds the observer off and pays the
fit out on lift. Copy and clear sit in a plain row: without them a selection is
text a thumb can highlight and never use.

### The phone re-states its size every time it is looked at

*FPLAN-0446.* The phone is a real tmux client and sizes like one: it states its
size when the socket opens, whenever its own box changes and the
`ResizeObserver` fires, and **on every return to the foreground**. The last is
needed because every way a pty moves from the host side leaves the phone's box
untouched, so nothing fires, and the phone would go on rendering a window it no
longer fits.

What that looks like in the hand is a room drawn wider and taller than the
client that is showing it: the right edge clipped mid-word, and the rows the
program drew for a taller terminal simply absent — **with the tmux status bar
still sitting at the bottom of the screen**. That is the tell: once the pty is
bigger than the client, the bar is the *last line of the stream*, so the bar is
the one thing that survives. What is lost is the body above it and the columns
past the client's width.

The re-statement uses the same idiom as `whileVisible` and for the same reason —
no clock, no poll, nothing running in a pocket. A resize to the size it already
is costs one small frame and is a no-op at the pty, so it is safe to say
*always*, and it is said unconditionally instead of guessed at. It is a
self-healing path aimed at the class, not a diagnosis of one trigger: whatever
moves the pty, the phone corrects it the moment it is looked at. `window-size
smallest` is set on these sessions, so a client that reports its size holds the
pane at it; a session with no clients reports the size its last client held.

### One message a frame

**The desktop face's cost is stream cost, not idle cost.** With a room attached
and nothing printing in it, the whole face costs **~3.4% of a core**: the fleet
snapshot is 40ms of CPU against a 5s cadence, the pty reader is a blocking read
rather than a spin, the resize path is debounced through `cancelAnimationFrame`,
and the two infinite `box-shadow` animations only exist while a card is actually
dispatched or actually running sub-agents.

**And the stream's cost rides on the number of messages, not on their size.**
Loads through one attached room, same terminal, same window, before frame
batching:

| what the room printed | bytes | writes/s | cost |
| --- | --- | --- | --- |
| nothing | 0 | 0 | 3.4% |
| a whole 48-row screen, 10x a second | ~44 kB/s | 10 | 32.9% |
| ~200 tiny flushed writes a second | ~1.6 kB/s | 200 | **134.5%** |

Twenty-seven times fewer bytes cost four times the CPU. That is the shape of an
agent streaming tokens.

**So a read is not a paint.** `pty.rs` gathers what the pty hands back for one
60Hz frame and crosses the bridge once, on a thread that sleeps on a condvar
while the terminal is quiet — an idle terminal wakes nobody at all. The token
stream costs **90.9%**, and the two cases with nothing to merge are unchanged:
3.3% quiet, 31.1% for the bulk repaint. Nothing is dropped, nothing is
reordered, and the exit event crosses behind the last byte the session wrote.
The only thing spent is up to one frame of latency on an echoed keystroke, which
is less than the paint that character was waiting for anyway.

**What is left is per-paint work, and the knob proves it.** A 33ms budget takes
the same stream to 60.7% — close to linear in the frame rate. The remaining cost
is the terminal drawing, not the bridge carrying, so the lever is the renderer
rather than a smaller number here: BAUD's terminal runs xterm's **DOM
renderer**, with no canvas or WebGL addon installed. Taking a renderer addon into
this face, and dropping the terminal below 60Hz, are both look-and-feel rulings
rather than performance tricks.

**The desktop face has no visibility gate.** Five `setInterval` lanes — the
fleet snapshot, the roster, two git sweeps and the bell — run at full rate
whether or not the window is on screen; `whileVisible` is the phone's.
