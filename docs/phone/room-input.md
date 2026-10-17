# The room: typing and the keyboard

This page covers input into a room: how a line and its Enter are delivered, why no tap opens a keyboard into the terminal, the compose slot and armed typing mode, the keyboard rule, and the key-bar chips. The terminal sheet itself is on [the room page](room.md).

← [the phone face](../phone.md)

### A line says what it is

Output leaves the room one frame at a time; input arrives in a **declared
shape**. Pressing Enter in the phone composer must send and submit, every time;
two independent mechanisms threaten that, and either one alone looks like luck.

**The first is a race.** A line and its carriage return written as two separate
frames become two writes into the PTY, and whether the far end reads them as one
chunk or two is decided by the network:

| gap between the two writes | what the program reads |
|---|---|
| 0 ms | `line\r` as ONE chunk - 30/30 |
| 1 ms and above | `line`, then `\r` - 30/30 |

A knife edge at about a millisecond. A reader with paste detection - Ink, which
Claude Code is built on - treats a CR buried inside a chunk as pasted text and
does not submit, and a lone CR as the Enter key.

A longer gap is not the cure - a bigger sleep moves the odds without making
anything certain. The line goes out wrapped in **bracketed paste**, so the
literal is marked as pasted text and the `\r` after the closing marker sits
outside it, unambiguously a keypress. Through a real tmux client, all four
landings of the race are correct at the pane boundary.

**The submit byte waits for proof rather than for a clock.** The far end can act
on the CR before the paste it follows has been committed, so it submits whatever
the box held a moment ago and the pasted text lands in the emptied box behind
it — an ordering inversion, not a paste heuristic, and specific to the far end
(bash's readline, a genuine bracketed-paste reader, handles both shapes
correctly). This face renders every byte the room emits, so it watches the room's
own buffer for the line to appear and submits the moment it does - the CR cannot
overtake a paste that has already been drawn. Whitespace comes out of both sides
of that comparison, because a wrapped line is broken across rows and a box pads
what it draws. A line already on screen is counted before the send, so
re-sending the same text cannot be satisfied by its own older copy. There is a
ceiling (`SUBMIT_CEILING_MS`, 600 ms): a program that echoes nothing still
submits, because refusing to submit would be a worse failure than the one being
fixed.

**Whose mode is being read** is worth stating, because the obvious answer is
wrong. Every room is a tmux session and the phone is a tmux *client*, so the
peer parsing these bytes is tmux - and tmux enables bracketed paste on its own
client unconditionally. That is exactly what makes reading it correct: the
entity whose mode is read is the entity that interprets the markers. tmux then
normalises, re-emitting the paste with markers to a pane that asked for them
and **stripping them** for a pane that did not, so a program with no paste
detection never sees an escape sequence it never requested.

**The second is Enter itself.** `event.key === "Enter"` on keydown is the one
signal Gboard does not deliver: with predictive text on, keydown arrives as
`Unidentified` and the intent only exists in `beforeinput`. Both signals are
caught, guarded by `isComposing` - an Enter that closes an IME composition is the
operator accepting a word, not submitting a line - and de-duplicated, because a
double submit would be worse than a missed one.

The send button and Enter run the identical path, to the byte, as one call so
they cannot drift apart.

### The room is a view

**No tap opens a keyboard into the terminal.** Typing *blind* into Claude Code's
own compose box, which the operator cannot see, is the trap, and mobile IME into
a terminal is unwinnable by construction: composition and autocorrect mean the
characters that arrive are not the characters you typed. Composed characters
never reach a slash menu as keystrokes, so it never filters, and Enter takes
whatever is highlighted — `/help` can run `prep`.

So the trap is closed **structurally** rather than by being made more accurate -
with no focus there is no blind typing to recover from. Every job focus is
load-bearing for is untouched: a tap still reaches tmux as a click, and xterm
still runs its own word selection.

**The stated-intent door points somewhere safe.** Arming ctrl or alt is typing
intent said out loud, and it needs a keyboard - "ctrl then a letter" has a
letter in it. That keyboard opens against a one-pixel field the chip row owns,
never against the terminal. BAUD reads what lands in it, translates it, and
writes the byte itself, so what crosses to the pty is a byte this app chose
rather than whatever an autocorrect decided a moment later. Composition cannot
reach the room raw because composition never touches anything the room can see.
The field is caught with `beforeinput`, because under a predictive keyboard the
letter exists only in the composition, and a modifier is never cleared when that
field loses focus, because the arrow chips honour a latched modifier and tapping
one can move focus.

**A frame taller than its room collides.** With the keyboard up, a room shrunk
below the program's UI height draws two frame lines on one row (six rows of UI in
four rows of pane). tmux keeps a bottom-anchored UI at the bottom of a shrunk
pane whether or not the program redraws on `SIGWINCH`, so the collision is the
program's own rendering at the size it was given; the slide below keeps the room
at full height instead.

### Typing goes into the room, through a door that is stated

Typing reaches **every** room — a shell prompt, a REPL, any TUI, not just Claude
Code's — through one stated door.

**The compose slot** is one rectangle with two modes. Default it is the baud
composer: attach, a predictive textarea that voice dictation lands in,
commit-on-send with the draw handshake behind it. Tap the `room` door on its left
and the whole rectangle becomes the armed bar — `typing → the room · raw keys ·
tap to stop` — and every key goes to the pty. The bar lives inside the
composer's footprint rather than on a permanent row of its own, so there is one
chatbox and the terminal keeps the height: the belt is 111px with the box empty
at 360px. The disarmed compose textarea has `autoComplete`, `autoCapitalize`
and `spellCheck` off, and newlines are flattened to a space as text is entered,
so a multi-line paste can never submit a line the operator did not.

**What is shared is the footprint, not the mechanism.** The room takes raw keys
and the box predicts, because the two cannot share one surface (see the trade
below). One slot, two modes, and only ever one of them mounted — so there is no
greyed-out second surface beside the live one to mis-aim at.

**The cost is width.** The `room` door takes the compose field from 221px to
175px at 360px — about 23 characters a line down to 17 — so the same message
wraps into more lines. The field's max-height is 8.6rem to pay for it (~112
characters visible at once). The door is a **word**, not a glyph, in a 40px box
that matches the paperclip's: a mode states itself in words.

Arming does **not** reopen the closed door. No tap on the terminal opens a
keyboard, ever. What arming changes is *where the fence sits*:

**Arming moves the mode, not the target.** The fence is a **mode** on xterm's
hidden textarea: disarmed, it carries `inputMode="none"` and a stray tap in the
room raises nothing; armed, it is an ordinary text field, the browser composes
into it and xterm paints the in-progress word on the cursor cell. Disarming blurs
it, which puts the keyboard away and empties it. xterm draws; BAUD delivers the
finished word to the pty — see below. Arming sets both `readOnly` and
`inputMode`, because neither alone is honoured by every mobile browser. A room
opens with the keyboard down on every attach and reattach. A blur disarms the
bar, except within 500 ms of arming, where focus can settle through an
intermediate blur.

**There is no mirror-diff.** Typing into a hidden field and reconstructing the
room's line by diffing that field against a remembered copy fails, because a
mirror cannot know when the far end rewrites its own line, and a tmux room
rewrites its line constantly: tab completion, `ctrl-R`, prompt redraws,
background output, vim's modes. Every one of those desyncs the copy, and the next
keystroke pays for it with backspaces computed against text the operator never
typed. noVNC shipped and then removed that pattern (PR #301, issue #357);
Guacamole's text-input mode survives only on a zero-lifetime buffer, no
remembered-value diff, and a flat refusal to interpret in-flight composition.
What ships here keeps no copy of anything.

**xterm delivers a soft-keyboard keystroke by reading the field back out, and a
predictive keyboard never fills it.** Every delivery path in xterm 6.0.0 resolves
a soft-keyboard keystroke by reading `textarea.value`: `_finalizeComposition`
takes `value.substring(start)` in a `setTimeout(0)` after `compositionend`, and
the "any textarea changes" lane diffs the value against a copy. The **preview**
is drawn from the *event's* `data`, never from the field — so it renders
identically whether the field ever took the word or not. Left to xterm, the
operator sees the word being typed and it vanishes on space, with zero bytes at
the pty.

So BAUD reads the **intent**, which carries its own payload:
`compositionend.data` is the committed word, and `beforeinput` carries the space,
the digits and punctuation prediction never composes, Enter (`\r`), backspace
(`\x7f`) and paste — the ones xterm drops on Android, where its input handler
requires `!composed || !keyDownSeen` and a Gboard insert is composed while a
keydown is still open. While the bar is armed, `attachCustomKeyEventHandler`
returns `false`, so **no key event reaches xterm at all**: the paths that could
only repeat a keystroke or send an empty one are cut at the root. Composition
events are not key events, so the preview is untouched by that cut.

The intent table is closed. `deleteWordBackward` sends `\x17`.
`insertReplacementText` and `insertFromComposition` send `event.data`, as
`insertText` does. Paste reads `dataTransfer`'s `text/plain`. Any other intent is
left to the browser, never given invented bytes.

De-duplication compares and never guesses: a prefix already sent is subtracted,
a word already contained in what was sent is dropped, and anything else goes
whole. On `compositionend` the word is taken from the event data first, then from
the field read from the composition's start, then from the last
`compositionupdate`. The field is emptied on every commit, armed or not, so
xterm's delayed read has nothing to send a second time.

The composition and `beforeinput` listeners are native listeners on xterm's
helper textarea, not React props: React's synthetic `onBeforeInput` can arrive
with no `inputType`, which is the one field this lane reads.

**The third source is the open composition.** When the space arrives as a *key*
while a composition is open, Chrome commits the word and fires **no
`compositionend` at all** — the only trace left anywhere is the last
`compositionupdate`. So a non-composing edit arriving while a composition is open
*is* the commit, and what was composed goes out first, in the order it was typed,
de-duplicated against whatever already went. The lane is tested over CDP —
`Input.imeSetComposition` and `Input.insertText` are the same code paths a soft
keyboard drives — against a real xterm 6.0.0, both with a field that takes the
composed text and with a field frozen empty.

**What xterm's own textarea buys for free.** It is parked **on the cursor cell**
as the cursor moves, and in-progress composition is painted there in the
terminal's own font. Text appears in the room as it is typed because the browser
draws it where the room says the cursor is. No code here draws it.

**The honest trade, said on the bar.** Per-keystroke terminal input and predictive
text cannot share one surface; nobody has shipped both. That is exactly why the
slot shares a footprint and not a mechanism. So the armed bar says which one you
are in — `typing → the room · raw keys · tap to stop` — and stepping out of it
gives the predictive box back, in the same place. Termux behaves the same way:
raw keys, no suggestion strip, dictation that prints on the pause instead of
streaming. A word Gboard *commits* arrives whole, because BAUD reads the commit
off the event; what cannot be had is the strip's per-keystroke correction of a
line the room owns — the room is not a text field, and nothing here pretends it
is. The `raw keys` wording is narrower than that truth.

**The one-pixel field is for the modifiers only.** `ctrl` and `alt` open the
keyboard against the chip row's own input, where a letter is read, translated
and written as a chosen byte. That lane never touches the room.

**The room slides; it does not shrink.** If you type into a room you have to see
the line you are typing, and the keyboard covers the bottom, which is where every
prompt lives. Shrinking the box so the fitter drops rows would mean a pty resize
on every keyboard open and close, and a re-render into a shorter pane is the
frame collision behind garbled lines. So the grid is left alone and moved: its
bottom edge lands at the top of the lifted belt and the screen clips the rest.
Nothing reflows, the room keeps every row, tmux is never told anything.

The distance is measured against **the belt's rendered top edge**, not against
the viewport. The belt is lifted to sit *above* the keyboard, so it — not the
keyboard — is what the last row has to clear; sliding to the visible bottom
parks that row squarely behind it. A rendered rectangle (`getBoundingClientRect`)
also stays true when the belt changes height, which it does on every mode flip,
and under any viewport policy; viewport arithmetic does not.

**The slide runs for any keyboard, not only for armed mode**, because a composer
keyboard would otherwise leave the prompt — and whatever was just sent — behind
the belt. Nothing is told to tmux either way, and with no keyboard the distance
is zero by construction, because the belt's top edge *is* the screen box's bottom
edge.

### The keyboard does not resize the room

`phone.html` leaves `interactive-widget` **unset**, which is the browser default
`resizes-visual`: the keyboard shrinks only the visual viewport. Under
`resizes-content` the keyboard shrinks the **layout** viewport, `100dvh` on
`.baud-phone` shrinks with it, `.baud-phone-term-screen` shrinks, and the
`ResizeObserver` fits and **resizes the pty** to one or two rows — and a TUI
cannot paint a composer in one row. With the token unset the room keeps its ~26
rows and slides under the keyboard instead, and tmux is never told anything, so
there is no reflow to survive. Keeping the key row off the keys is the belt
lift's job on every browser (Firefox never honoured the token at all). If that
lift fails, the answer is to float the belt and floor the screen at ~10 rows,
not `resizes-content`.

The viewport meta is `width=device-width, initial-scale=1.0, viewport-fit=cover`;
`viewport-fit=cover` is what makes `env(safe-area-inset-*)` resolve on a notched
phone. The belt lifts by `max(0, innerHeight − visualViewport.height −
visualViewport.offsetTop)`, which is 0 on a browser that resizes the layout
viewport.

**The fit waits for the box to stop moving.** The observer's fit is debounced
120ms (`FIT_DEBOUNCE_MS`) and **trailing**, so the pty is asked once, for the
size the box came to rest at: a rotation, a pane opening, and the belt changing
height all move this box, and a `fit()` and a `resize` frame per animation step
is the re-render-into-a-shorter-pane collision the slide exists to avoid. The
immediate declarations are on attach, on a font change, on a fit held back
through a drag, and on every return to visibility. Taps are aimed correctly —
the hit test measures the transformed box, so the slide corrects the aim instead
of skewing it.

Because characters reach the room as real bytes as they land, everything
interactive works — a shell's tab-completion and history, a REPL, and Claude
Code's slash menu filtering as you type.

### Key-bar chips

**Key-bar chips are `flex: 1 1 auto`.** `flex: 1` is `flex: 1 1 0%` — every
slot gets an *identical* width whatever is in it, so the only four-letter label,
`CTRL`, would overflow its border. `flex: 1 1 auto` starts each slot at its
content width and shares the slack, so `CTRL` takes the ~32px it needs and the
arrows give up a few they never use. Clipping with `overflow: hidden` would show
a chip reading `CTR` — a control that lies about which key it sends is worse than
one that is a few pixels wide.
