# The phone's input system — as built at `2d744ac`

<!-- A CAPTURE, not a narrative. The README says why this shape was chosen and
     tells the story of the night it was found; this file says WHAT IS SET, at
     one named commit, with the line it is set on. Read this to rebuild or
     revert the state; read the README to understand it. Where the two overlap,
     the tree is right and both files are stale until fixed. -->

**Captured** 2026-08-20, against commit `2d744ac` (`fix(phone): FPLAN-0446 night
arc r4-r8 save-point`), the revert-point Patrick called for at 00:59. Every line
number below is that commit's; every value was read out of the tree, not
remembered. Nothing was rebuilt, deployed or changed to write this — the capture
is docs-only by ruling ("no more changes tonight", 01:08).

**Scope.** The lane that carries a thumb's keystroke from Gboard to a pty, and
the three things wrapped round it that decide whether that keystroke has a room
to land in: the viewport contract, the liveness watchdog, and the ended-room
rule. All of it lives in `app/src/phone/TerminalSheet.tsx` (2983 lines) unless
another file is named.

---

## 0. Am I on this state?

| Check | Command | Answer at capture |
|---|---|---|
| Tree | `drone @git log 1` | `2d744ac` |
| Live phone bundle | `ls app/dist-phone/assets/` | `phone-DmS-hzPM.js` (707,188 B), `phone-BKYTlM_6.css` (80,692 B) |
| Which tree built it | `grep -ao 'baud-tree [^"]*' app/dist-phone/assets/phone-DmS-hzPM.js` | `baud-tree d29b6ad +13 dirty` |
| xterm | `node -p "require('./app/node_modules/@xterm/xterm/package.json').version"` | `6.0.0` |

**The stamp does not say `2d744ac`, and that is the honest state, not a typo.**
The build stamp (`app/vite.config.phone.ts:30-47`) records the tree at build
time: parent `d29b6ad` plus 13 dirty paths. The commit carries **14** files. So
the served bundle was built from a tree one path short of what was committed
minutes later, and *which* path cannot be recovered from a count. Consequence,
stated rather than buried: **the live bundle is not provably reproducible from
`2d744ac`**. A rebuild would settle it and was not run tonight.

---

## 1. Viewport contract — `app/phone.html`

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```
`app/phone.html:30`. Three tokens, and one deliberate absence.

| Token | Why it is there |
|---|---|
| `width=device-width, initial-scale=1.0` | The ordinary mobile baseline. |
| `viewport-fit=cover` | Makes `env(safe-area-inset-*)` in `phone.css` resolve to real numbers on a notched device. Without it they are zero. |
| **`interactive-widget` — UNSET** | Browser default `resizes-visual`: the soft keyboard shrinks the **visual** viewport only and leaves the layout viewport alone. |

**What the absence is worth.** It was `interactive-widget=resizes-content` from
DPLAN-0301 until FPLAN-0446 r8. That token shrinks the *layout* viewport, so
`100dvh` on `.baud-phone` shrank with it → `.baud-phone-term-screen` shrank →
the `ResizeObserver` in `TerminalSheet` fitted → **and resized the pty**. The
room collapsed to ~1 row the moment the keyboard opened. Words were never eaten
and never painted: CC/Ink refuses to draw its composer under 6 rows, while bash
echoing happily at 1 row was the false control that kept the bug alive for days.

**What the keyboard does now.** It covers the room instead of shrinking it, and
two measured moves answer that (`TerminalSheet.tsx:1867-1965`, effect keyed on
`typing`):

1. **The belt lifts.** `hidden = max(0, innerHeight - visualViewport.height -
   visualViewport.offsetTop)`; the belt takes `translateY(-hidden)`. Self-
   correcting: on a browser that resizes the layout viewport, `hidden` is 0 and
   the transform clears.
2. **The room slides, it does not shrink.** With the slide zeroed first, the
   room measures `covered = max(0, screenBox.bottom - beltTop)` off
   `getBoundingClientRect()` — the belt's **rendered top edge**, never viewport
   arithmetic — and takes `translateY(-covered)`. Nothing is told to tmux, no
   rows are lost, `.baud-phone-term-screen` clips the overflow, and
   `cellUnder`'s tap aim self-corrects because it measures the transformed box.

The gate is **`covered > 0`**, not `typing && covered` (r8). With no keyboard,
`covered` is zero by construction — the belt's top edge *is* the screen box's
bottom edge.

**If the belt lift ever fails**, the recorded answer is: float the belt and
floor the screen at ~10 rows. It is **not** a return to `resizes-content`.

Related setting: `FIT_DEBOUNCE_MS = 120` (`:377`) — the fit the ResizeObserver
owes once the box stops moving. It survives the token's removal because it was
never only about the keyboard (rotation, panes, belt height).

---

## 2. The input lane — reading intent, never the field

### The defect, in xterm 6.0.0's own terms

xterm resolves a soft-keyboard commit by **reading `textarea.value` back out** —
`_finalizeComposition` takes `value.substring(start)` a tick after
`compositionend`, and the "any textarea changes" lane diffs the value against a
remembered copy — while it **paints its preview from the event's `data`**. Two
lanes, one screen. When Gboard's prediction commits a word the field never took,
the preview looks perfect and every value read is empty: the word is visible
while composing and gone on space, with zero bytes at the pty. That is exactly
what Patrick reported.

### The fix: read the intent, which carries its own payload

| Hook | Where | What it does |
|---|---|---|
| `compositionstart` | `:1019` | Opens `composing = {on, text, sent, start}` (`:895`), anchoring `start` at the field's current length. |
| `compositionupdate` | `:1026` | Stores `event.data` as `text` — the **only** trace of a word that a key commits without ever ending. |
| `compositionend` | `:1042` | Sends `unsaid(event.data \|\| held.slice(start) \|\| text, sent)`. Data first, field second, last update third. Empties the field on **every** commit, armed or not. |
| `beforeinput` | `:1069` (`onHelperInput`) | Everything that is not a composition. If a composition is open, the composed text goes out **first**, then this edit. `preventDefault()`, field cleared. |
| `attachCustomKeyEventHandler` | `:983` | `() => !typingOn.current` — armed, xterm's key paths are refused so nothing double-fires; disarmed, `true`, which is xterm's normal behaviour. |

All four listeners are **native**, bound to `.xterm-helper-textarea`
(`helperField`, `:786`), added at `:1089-1092` and removed at `:1698-1701`.
React's `onBeforeInput` is a legacy synthetic event whose `nativeEvent` may be a
`TextEvent` with no `inputType` at all — the one field this lane reads. Door C
shipped on the React props and delivered **zero** bytes to any pty.

### `editBytes` — the intent → byte table (`:133`)

| `inputType` | Bytes |
|---|---|
| `insertText`, `insertReplacementText`, `insertFromComposition` | `event.data ?? ""` |
| `insertFromPaste` | `dataTransfer.getData("text/plain")` — the one intent whose payload is not on `data` |
| `insertLineBreak`, `insertParagraph` | `\r` (CR, not LF — line discipline is the room's job) |
| `deleteContentBackward` | `\x7f` |
| `deleteWordBackward` | `\x17` |
| anything else | `null` — left to the browser, never invented |

`unsaid(whole, said)` (`:105`) is the whole de-duplication: a sent prefix is
subtracted, a word already contained in what was sent is dropped, anything else
goes whole. It compares; it never guesses.

### Arming (`toggleTyping`, `:2329`)

The ref is the source, not a `setState` updater (a replay would flip the flag
under a committed `true`). In order: set `typingOn.current`, stamp `armedAt`,
`setTyping`, `allowKeyboard(now)` — which sets `readOnly = !allowed` and
`inputMode = allowed ? "text" : "none"` (`:791`) — then `term.focus()` or
`helper.blur()`, and **last** `onComposeFocus?.(now)` so the rail's compaction
is the final word after the synchronous blur the focus move fires.

A room opens with the keyboard **down**: `allowKeyboard(false)` right after
`xterm.open()`, and the bar goes down with every reattach (`:968-988`). An armed
bar with no keyboard behind it is a lie about where the next keystroke goes;
`onHelperBlur` (`:999`) disarms on blur, guarded by `BLUR_GRACE_MS = 500`
(`:358`) so the focus that arming itself causes cannot switch it back off.

### Settings inventory

| Constant | Value | Line |
|---|---|---|
| `BLUR_GRACE_MS` | `500` | `:358` |
| `FIT_DEBOUNCE_MS` | `120` | `:377` |
| xterm `convertEol` | `false` | `:953` |
| xterm `scrollback` | `2_000` | `:959` |
| xterm theme | bg `#070a09`, fg `#d6e2dc` | `:960` |
| Font stack | `"JetBrains Mono", "IBM Plex Mono", ui-monospace, "DejaVu Sans Mono", monospace` | `:955` |
| Scroll-speed knob | `SCROLL_MIN 50` · `SCROLL_NEUTRAL 100` · `SCROLL_MAX 400` | `PhoneSettings.tsx:137-143` |

Wire rules that the input lane depends on: **binary out, always** (`write`,
`:842` — a text frame can never reach @api's pty), **text in is control**,
**binary in is room output** (`live.onmessage`, `:1239`).

---

## 3. Autocorrect — a feature that arrives free, and where it is a hazard

**It is not built; it is what web composition already does.** Because BAUD reads
`compositionend.data`, Gboard's correction — which lands *before* the commit —
is inside the string BAUD sends. The **revision verb** (Gboard deleting and
re-committing a word it has changed its mind about) was proven live on device:
it arrives as ordinary delete + insert intents, which `editBytes` already has
bytes for.

**Termux, the reference Patrick trusts, cannot have this.** Recorded from the
FPLAN-0446 arc at `2d744ac`: Termux's `TerminalView.java` sets `TYPE_NULL` on
its input connection, which turns prediction and correction off at the source.
*Not re-verified in this docs round* — no source was fetched tonight; it is
recorded here as the arc recorded it, with its own citation attached.

**Feature in prose, hazard in commands.** A corrected word is a gift in a
message to an agent and a defect in `git cherry-pick` — the room is not a text
field and nothing here pretends it is. Two levers, both recorded, neither built:

- **Today's off-switch is global**: Gboard's own settings. BAUD has no per-
  surface control, and the armed composer surface is xterm's textarea, which
  carries no `autocorrect`/`autocapitalize` suppression today.
- **Parked as the future per-surface lever**: `EditContext` (Chrome 126+),
  which would let this face own composition state per surface instead of
  borrowing a textarea's. Recorded as a direction, not a plan. *Version not
  re-verified in this docs round.*

The **disarmed** composer is explicitly the other way round — `autoComplete
="off"`, `autoCapitalize="off"`, `spellCheck={false}` on the compose textarea
(`:2931-2933`) — with prediction still live because it is a normal field and his
voice dictation lands in it.

---

## 4. Liveness — measure if you can, guess if you must

A browser has **no ping API**: the protocol's own ping/pong is answered below
JavaScript and never surfaces. Meanwhile uvicorn pings every 20s and hangs up on
a pong that does not return inside 20s. So the room can be torn down on a clock
this side does not share, and a dead room and a quiet room are the same picture.

**Two lanes, feature-detected per socket, never version-coupled** (`:1120-1300`):

| Lane | Trigger | Verdict rule |
|---|---|---|
| **Round trip** (`pongLane`) | One `{"type":"ping"}` per socket at `onopen` (`:1190`); a `{"type":"pong"}` back latches the lane (`:1263-1269`) | `now - lastPong > PONG_DEAD_MS` → close, status *"the room stopped answering"* |
| **Silence guess** (fallback) | No pong ever comes back | `now - lastRx > SILENCE_MS` → close, status *"no bytes from the room for 90s"* |

| Constant | Value | Line | Why that number |
|---|---|---|---|
| `SILENCE_MS` | `90_000` | `:423` | Benched: longest gap on a live **idle** room was 29 s inside a 62 s window. 3× the worst measured gap. A 15 s watchdog would execute a healthy room ~once a minute, and each kill costs the desk a full repaint. |
| `LIVENESS_TICK_MS` | `10_000` | `:426` | How often the watchdog looks — **while visible only**. |
| `PONG_DEAD_MS` | `30_000` | `:430` | Three ticks, so one lost tick is never on its own a verdict. |
| `RECONNECT_MS` | `[0, 1_000, 3_000, 6_000, 12_000, 30_000]` | `:442` | First rung immediate; then it backs off hard. @api's log caught 13 attaches in 3 minutes the night this was written. |
| `RECONNECT_TRIES` | `6` (= ladder length) | `:447` | Then it **stops and says it stopped**. |
| `HANDSHAKE_POLL_MS` | `1_000` | `:451` | A handshake in flight is re-checked, never counted as a try. |

**Exactly one probe per socket, never a retry loop**: a host without the lane
logs a warning for every unknown control frame (@api `server.py:_handle_control`
— read before this was built, which is also how it is known an unknown frame is
ignored and never fatal). A keepalive that fills somebody else's log is a bug
wearing a fix's coat.

**HONEST, AND STILL TRUE AT CAPTURE: the pong lane is dark.** @api's ping/pong
is dispatched but not live on prod 8787; until that restart window, **every
socket runs the 90-second silence fallback**. Nothing needs changing here when
it lands — the first pong on any socket turns the better lane on by itself.

**Nothing runs in a pocket.** The watchdog is bound to `visibilitychange`
(`watch(on)`, `:1162`): hidden stops it, visible restarts it *and* resets
`lastRx`/`lastPong` (`onVisible`, `:1597-1655`) — a phone in a pocket was not watching, and
carrying that dead time forward would execute a healthy room on the first tick
after every pocket. The same return re-states the geometry (`fit.fit()` +
`sendResize()`), because every host-side way the pty moves leaves the phone's
box untouched.

**The reconnect lane is one place and the only place a socket opens** (`:1757`).
It runs while visible, resets its count on every fresh look, refuses to open
over a `CONNECTING` socket, and bails if the socket came back OPEN while a rung
was ticking. It deliberately does **not** ask whether this sheet's tab is on
screen: every open pane stays attached by doctrine, and the bill is bounded by
the ladder (N dead panes cost at most N×6 attaches per look).

**The dead-room scrim** (`:2487-2510`) sits **on** the grid, not above it —
xterm can only keep painting the last frame it was handed, so the picture is
what lies and the correction goes on the picture. The stale frame stays legible
underneath, dimmed. It says two different sentences for two different
situations: *"trying again by itself while this screen is open"* versus *"not
trying any more — the room did not answer. Tap to try again."* The reattach
button is always live.

---

## 5. The one-slot composer

**Patrick, 00:39:** *"type in this room, it's going to be the only chatbox we
need… I don't need 2 comment boxes."* The type bar was a permanent row above the
belt; once typing mode worked, that row was a second compose surface parked over
the first. One rectangle now carries both modes and morphs between them
(`.baud-phone-term-input`, `:2832`).

| Mode | What fills the slot | Lane |
|---|---|---|
| **Default** | `room` door · paperclip · compose textarea · `send` | Predictive. Commit-on-send, with the draw handshake behind it. Unchanged to the byte. |
| **Armed** | One full-width button: `typing → the room · raw keys · tap to stop` | Raw keys through the intent lane above. |

- **The mode is always literal words, never a lit icon** — his trust rule, and
  the one thing this round could not trade for width.
- **The footprint merged, the mechanism did not.** Per-keystroke terminal input
  and predictive text cannot share one surface. They share a rectangle because
  they can never share a surface.
- **Measured cost**, off the built stylesheet at 360 px: the arm door takes the
  compose field 221 px → 175 px (~23 → ~17 characters a line), its max-height
  raised to keep roughly the same amount of message visible (~120 → ~112
  characters). What it buys: the belt goes 143 px → 111 px with the box empty —
  **32 px, about two rows, handed back to the terminal permanently**.
- **Left placement**: `room` is leftmost so the paperclip keeps its rule (it
  sits directly left of the line it writes into) and `send` stays under the
  thumb at the right edge. **Accepted as-is at 00:54** (*"I kind of like it like
  that"*) — **the layout is FROZEN**; Patrick is holding an idea of his own.
- **No focus theft**: both mode buttons `preventDefault()` on `onPointerDown`.
  Tapping a `<button>` gives it focus, and on a phone that can land after the
  handler's own focus move — the field blurred the instant it was focused is the
  likeliest reason door C typed nothing.
- **Enter is caught twice on purpose**: `onKeyDown` (`:2953`) and a native
  `beforeinput` listener keyed on `insertLineBreak`/`insertParagraph` (`:2172-2181`),
  funnelled through `submitOnce` (`:2141`) so a browser that fires both cannot
  double-send. Gboard's keydown arrives as `Unidentified`/229 with predictive
  text on — the intent only exists in `beforeinput`. The `typing` dependency on
  that effect is **load-bearing**: the textarea unmounts on arm, so without it
  Enter would stop sending after one trip through typing mode.
- **Newlines are flattened on the way in** (`onChange`, `:2950`), not in
  `send()`: a `<textarea>` keeps a pasted `\n` where the old `<input>` could
  not, and `send()` writes the literal in one call — so an embedded newline
  would be a submit the operator never pressed.
- **Write first, clear second** (`send`, `:2094`): the text belongs to the
  operator until the bytes are known to have gone.

**The key bar** (`CHIPS_LEFT` `:166`, `CHIPS_RIGHT` `:178`) sends **real control
bytes**, never key names, into a stream that interprets nothing — which is why
there is no allowlist to enforce. `esc` (hold: `esc esc`), `tab`, `⇧⇥`
(`\x1b[Z`), `^C`, four arrows, `⏎` (hold: `\n`, newline without submit). Sticky
`CTRL`/`ALT` are Termux-exact: **tap latches for the next key, long-press locks
until tapped off**. Arrows are the one family that combine latched modifiers
(`\x1b[1;<param>` where param = `1 + alt·2 + ctrl·4`, `:71`). A character Ctrl
has no byte for returns `null` and passes through untransformed, keeping the
latch — inventing a byte would be interpreting.

---

## 6. The ended-room rule

**@api attaches with `tmux new-session -A` — attach-or-CREATE.** Since r5 the
sheet reconnects by itself, so a retry into a room the operator just killed does
not fail: it **builds a new empty room wearing the dead room's name**, quietly
undoing his own gesture.

The catch, as wired:

| Piece | Where | Rule |
|---|---|---|
| `VerbChips` | `VerbChips.tsx:91` | `onEnded?.()` fires **only on the machine's `ok`**, never on the request leaving. A refused kill leaves the room alive, and closing its pane would be this face inventing an outcome. |
| `AgentSheet` | `AgentSheet.tsx:147-159` | `onEnded` is distinct from `onDetach`: detach closes a client, this one fires when the session is gone. |
| `PhoneApp` | `PhoneApp.tsx:1255` | Closes the pane; **the sheet deliberately stays open**, because the chip renders the machine's sentence inline and it is the only confirmation he gets. |
| `intent.ts` | `intent.ts:81-90` | `roomEnded(project, branch)` / `markRoomEnded(...)`, stored in `localStorage` under `baud.rooms.ended` as `["<project>/<branch>", …]`. Corrupt storage reads as empty, never as a crash. |
| Startup seat | `PhoneApp.tsx:649` | The startup agent will not open a room the operator ended. |

**The gap, named rather than patched** (it is named in the code too): on this
face `roomEnded` is **always false today** — the mark lives in `localStorage` and
**nothing on the phone writes it**; the `end room` verb kills the session and
records nothing. The guard stands ready for the day the phone's kill door learns
to mark its rooms. Costs one import; closes the exact bug the desk already paid
for once.

---

## 7. Known issues — honest and dated (2026-08-20)

1. **Random `aipass` shell-terminal breakage on `phone-DmS-hzPM.js`.**
   Undiagnosed. Some shells broken, the CC seat fine. Patrick, 01:08: *"it
   random we do tmro"* — diagnosis is tomorrow's first job, and nothing was
   investigated tonight beyond writing this down. **Prime suspects, recorded at
   the time and not since tested:** the slide gate widened from `typing &&
   covered` to `covered` (`:1939`), and the textarea unmount/remount rework that
   comes with the one-slot morph.
2. **The live bundle is not provably reproducible from `2d744ac`.** Its stamp
   reads `d29b6ad +13 dirty` against a 14-file commit (§0). The bundle shipped
   from an in-flight rebuild that raced past the accepted `B0ruYWwv` cut, whose
   assets `emptyOutDir` had already wiped — which is why no one-click rollback
   existed, and why the commit does.
3. **The pong lane is dark until the prod 8787 restart window.** Everything
   today runs the 90-second silence fallback (§4). No client change is needed
   when it lands.
4. **Fullscreen pan/drift.** Reported, not diagnosed. The fullscreen toggle only
   sets a class on the section — xterm, its socket and its objects are the same
   before and after — so this is a layout question, not an attach one.
5. **Keyboard double-resize question.** Open: with `resizes-content` gone, it is
   unconfirmed whether any browser still delivers two `visualViewport` events
   per keyboard open, and `place()` is idempotent by measurement rather than by
   guard.
6. **The armed bar says `raw keys`, and that wording is now narrower than the
   truth** — a word Gboard *commits* arrives whole (§3). It stays until Patrick
   has judged the lane on the device: renaming a control mid-test changes what
   he is testing.
7. **Found in the tree while writing this, author unknown:** `.backupignore` is
   modified against `2d744ac`, adding one line — `target/`. It is not this
   round's work and is attributed to no one. Left in place, uncommitted by this
   docs round.

---

## 8. To rebuild or revert this state

```
drone @git log 1                     # expect 2d744ac
cd app && npm run build:phone        # writes dist-phone/ — emptyOutDir WIPES the old assets first
```
`emptyOutDir: true` (`vite.config.phone.ts`) is why there is no rollback by
copy: the previous bundle is gone the moment a build starts. **The commit is the
revert point** — that is the whole reason it exists. Build only from a tree you
are willing to serve, then read the stamp back out of the bundle to prove which
tree it was:

```
grep -ao 'baud-tree [^"]*' app/dist-phone/assets/phone-*.js
```

Audit lane before claiming green, unchanged: `cargo test` · `cargo clippy` ·
`npx tsc --noEmit` · `npm run build`. Note that **no CI workflow builds the
phone bundle** (recorded in `MAP.md`) — this lane is hands-only.
