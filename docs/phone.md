# The phone face

The phone face: what each screen does and why.

## The phone face — a wheel of agents, read by default

`npm run build:phone` emits `dist-phone/`: BAUD as a wheel of agents, installable
to a phone home screen, built from **the same React components** as the desktop.
See *The wheel* below.

The entire port is one alias in `vite.config.phone.ts`. `host/index.ts` imports
`./transport`; that build resolves it to `transport.http.ts` — `fetch` against
@api's host API — instead of the tauri binding. The typed verbs, the cards,
the bell and the palette are compiled unchanged. The proof is mechanical: the
phone bundle contains **zero** occurrences of `@tauri-apps`, and the `/v1`
routes it does contain came from the transport table alone — plus two doors that
are not table rows because they are not JSON request/response: the room socket
(`/v1/room/attach`) and the multipart upload (`/v1/files/upload`).

The counts move as the seam grows, so this page does not carry them. Count them
instead: the typed verbs are the exports of `host/index.ts`, the http table is
the rows of `transport.http.ts`, and, after `npm run build:phone` in `app/`,
`grep -oh '/v1/[a-z/-]*' dist-phone/assets/*.js | sort -u` lists the routes the
built bundle contains — the table's distinct routes plus the socket and the
upload.

**The refusal table points both ways.** `transport.http.ts` refuses the verbs a
phone cannot perform *by name*; `transport.ts` carries the mirror image,
`NOT_ON_THIS_FACE` — the git app's five reads have no Rust command behind them
and should not have one, because the desk sits three feet from the repository
with the operator's own git in a terminal. Without the table those names would
reach `invoke` and come back as tauri's *command not found*, which reads as a
broken build rather than as a face that was never meant to have them. It is
deliberately **not** applied to the older phone-only verbs.

The seam is command-shaped and `/v1` is REST-shaped, so `transport.http.ts` holds
a table from command name to route, and holds it alone. Verbs the phone cannot
perform are refused **by name** with a reason (`pty_create` → "the phone has no
pty") rather than silently failing — a designed absence and a bug should not look
the same from a phone.

**No token is ever baked into the bundle.** The face opens on a paste-token
screen, proves the token against `/v1/whoami` before showing anything, and keeps
it in `localStorage`. A refused token and an unreachable server are reported as
different failures, because they send the operator to different places.

**A read token is not a harmless mirror.** It refuses every verb by name, but the
file lane has a `home` root, so it also reads whatever a person can read on that
machine, private keys included. The full exposure is under **The FILES app**
below.

**Browsing is free, and the seat is a default rather than a fence.** Any agent's
project files and any passport can be viewed, with no restriction. `/v1/files`,
`/v1/dir` and `/v1/diff` take a `project` and resolve it through BAUD's own
census, exactly as `/v1/fleet` does — an unknown branch inside a known project is
a 400 naming both, an unknown project is a 503 carrying BAUD's own census
sentence, and the per-branch path fence is untouched: browsing is free across
*branches*, never across the disk.

**So the phone names the project on every read.** Omitting it is not a smaller
request, it is a *different* one: projects share a naming convention, so
a read aimed at a foreign agent and resolved under the seat does not fail —
it finds a same-named local agent's file and shows it as this one's. The three
read verbs in the seam take an optional project and leave the key off the
payload entirely when there is none, so the desktop — which resolves under the
seat it already sits in — hands `invoke` the same object it would without the
argument.

**Reads are not verbs.** Opening a file and reading a diff are exactly what the
read lane serves. Each card carries a read row (diff, readme, memory, dashboard,
inbox) that opens a full-height reader, and the card's own figures open the file
they came from. A `feed` screen replaces the desktop's drop-down shade: same
events, cursor-keyed, and when the server reports a `gap` the screen says so — a
window that silently lost events looks exactly like a quiet night, and those are
opposite things.

**The `GIT` tile is live, and it has three answers rather than a number with a
fallback.** It rides `/v1/git-changes`, which matches the desktop's *semantics*
and not just its shape — tracked files only, branch-local paths, `git diff HEAD`
relative — so the two faces cannot disagree about the same branch at the same
moment. The response also carries `untracked`, and the tile **deliberately drops
it**: rendering it would make the phone's tile mean something the desktop's does
not, which is the exact divergence the matched semantics exist to prevent. It
belongs on both faces or neither, and the desktop is frozen.

**The tile's number drops untracked; the screens behind it do not** — which is
not a contradiction, because they are answering different questions. The tile is
the desktop's figure and stays matched to it. The tile is also a *door*: it opens
the changes screen described below, and that screen asks the same route for the
whole envelope — git's own two-column codes, untracked files **by name** —
because a list of what changed that silently omits the new files is a list nobody
can act on. A count that means one thing and a list that shows more is honest as
long as both say which question they answered.

The three answers are the point. `0` is a **fact** — it says nothing has changed
in this branch — so a lane that cannot answer must not be able to produce it.
A refusal renders `n/a`, which cannot be read as a number, and carries the
server's own sentence with it; the em dash stays for *asking* and for a branch
with no git at all, which are absences rather than failures. An empty list
painted as clean is the one lie a glance would read as truth and act on.

**And the tile refuses for real reasons, not for being far away.** Foreign
projects answer `200` with real data; a `503` carries a true statement about that
project, such as *"fatal: not a git repository"* for a project with no git, rather
than a fence. A tile keyed on *foreignness* would paint other projects' correct
counts as unavailable, which is the same lie told in the other direction.

**And the bell counts while that screen is shut**, which is the only stretch a
badge is for. The feed screen polls its own cursor lane, but it mounts on open
and unmounts on close, so the count lives a level up, on the desktop `Bell`'s
model: poll the feed (on the cursor — see **Nothing polls a pocket** below), hold
a marker for how far the operator has read, badge the difference, key the marker
per project because another project's feed is another history. It diverges from
the desk in one deliberate place. The desktop's shade is a glance with a `CLEAR`
button beside it; the phone's feed is a full-height screen you must leave to get
back to anything, so **leaving is the read** — the marker moves on close, never
on open, so nothing can be marked read while it is still arriving behind the
screen you are looking at.

**The name in the header is the refresh**, because browser and OS gestures fight
for the pull-to-refresh gesture. Tapping `BAUD` flashes it amber for 200ms and
then does a full `location.reload()` — the same thing a browser refresh does,
deliberately, because that is the gesture being replaced. It is lossless:
nothing this face knows lives only in this face. The seat is in `localStorage`,
every room is a tmux session on the host, and the fleet is one poll away. So
there is no confirm, no double-tap, and no ceremony.

The 200ms is not a delay, it is the acknowledgement. A tap that shows nothing
until the page comes back reads as a dead button on a slow reconnect, and the
operator's next move is to tap it again. `:active` paints amber while the finger
is still down — instant, and it costs no render — and the flash holds through the
reload.

**And the name wears the wordmark's green.** It drinks `--baud-green` and a glow
at the desktop wordmark's own ratio — 0.6em of the type size, so 8px around
13.6px of text rather than the desk's 12px around 20px, which at this size would
be a smudge. One identity in two sizes. The tap answers amber, halo included,
because amber on green is a state change you cannot miss.

The served-bytes check this repo runs proves *tree matches serve*, which is not
the same claim as *git matches serve*: a build from an uncommitted tree is served
as faithfully as a committed one, and `emptyOutDir` wipes `dist-phone` on every
build, so a served bundle cannot be recovered afterwards. The bundle carries a
`baud-tree <stamp>` string naming the tree it was built from (the short `HEAD`
and either `clean` or a count of dirty paths), so one `curl` of the served bundle
answers which tree it is.

**Only the hit area is larger than the word.** The word is a `<button>` whose
position and size match the plain text it replaces. The thumb target is a
pseudo-element, so the layout never learns about it: it reaches the screen's own
left edge, up through the notch inset, down to the header's bottom edge, and
right by 10 of the 14 pixels of gap — leaving four pixels of dead space that
always belong to nobody. That is **60 × 30** on a 360px face, plus whatever the
safe-area inset adds when it is installed. It deliberately stops at the header's
bottom edge: an overhang there would take taps from the wheel, and a refresh that
eats a card tap is a worse bug than a target 14 pixels short of the 44px
guideline. Going the rest of the way would cost either header height or wheel
taps.

**Three verbs, and refusal is a state rather than an absence.** The phone can
*wake* an agent, *end a room* and *lock the machine's screen* — chips under
each card, plus one lock chip in the header, because there is one machine. Under
a read-scoped token every chip is **still there**, dimmed, carrying the sentence
that says why it will not fire; hiding them would make a designed absence look
exactly like a broken build. A read-scoped token is the everyday case, so that
dimmed state is the everyday one, not an error path.

**The header lock chip reads the lock, too** (FPLAN-0585). Away from home, a
glance should answer *did I lock the laptop?* — so the chip polls `GET /v1/lock`
(@skills' `lock_state()`, relayed verbatim by @api, read scope) every 5 s while
the app is looked at, re-reads at once and again a second after a tap because the
lock lands async, and forgets the reading when the app goes away. An OPEN shackle
in green is unlocked. The closed shackle in amber is locked — attention, not
failure, since red on this face means dead or refused. The closed shackle, dim
and with a dashed border, is *unknown*: the machine could not tell, or the read
failed, and the title carries the reason. Unknown is never drawn as unlocked.
Before the first answer the chip is the plain lock chip, and because the read
rides the read scope, a read-scoped token sees the lock's position even though
its tap is refused.

`wake` names a branch, a project and a message — and **no model**, because the
branch's own config decides what wakes in it. The project travels with the
branch on both `wake` and `kill`: a room name carries its project scope, and
resolving it against anything else names a different room.

Three client-side guards sit in front of the destructive verb, and each one is
the client's job *precisely because the server must not rely on any of them* —
anyone holding the token can call the endpoint with no browser at all. They
narrow the accident, not the attack: scope, a screen that must actually be
visible (a tap queued behind a lock screen never ends a session), and a confirm
dialog. The server is never told that a human confirmed, because a claim like
that from a client is worth nothing.

**There is no fingerprint on this connection.** WebAuthn exists only in a secure
context, and the phone is served over plain http on a tailnet address, so it
never prompts. The call is gated on `window.isSecureContext`: when that is false
nothing is attempted, and the dialog says *on this connection your tap is the
confirmation — no fingerprint is asked*. The result line starts *verified by this
device ·* only after a real WebAuthn success.

**The verbs are `POST /v1/verbs/{wake,kill,lock}`.** A `GET` is 405, because a
destructive action must never be a link, and `kill` reaches the desktop through
`--end-room` above. The payloads are the rows in `transport.http.ts`: `wake`
sends `branch`, `project` and `message`; `kill` sends `branch` and `project`;
`lock` sends an empty body.

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

**Links and copy out of a room** (FPLAN-0641). A login prints an OAuth URL into
the room. Two doors read one detection, `app/src/phone/lib/roomLinks.ts`, so the
panel can never list a link the tap cannot see, or the reverse.

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
permissions dance. The bytes go to `POST /v1/files/upload` as multipart with the
field named **`image`** (operate scope, the server names the file — a
phone-supplied filename is untrusted), and the response's **absolute path is the
entire product**. The phone then types that path into the already-open socket.
The field name is pinned here because a stand-in harness speaks the spelling its
own author believes in: a wire detail with two possible spellings has to be read
off the other side, never inferred.

This is not a new mechanism; it is the desktop's, reached from a pocket.
`screenshot.rs` line 3 states it: Claude Code reads images by path, so "send a
screenshot" means get bytes onto disk and type where they landed.

- **One quoting rule, in `deliver.ts`.** A rule with shell semantics that exists
  twice is a rule that drifts, and the drifted copy does not look wrong — it
  mis-escapes a path and the operator's line quietly means something else. The
  camera button, the drop handler and the photo picker all call the same
  `deliveryText()`.
- **Quoted only when needed, wrapped in spaces** so the path joins whatever the
  operator was already typing.
- **Never submitted.** No newline exists anywhere on this path. Enter is the
  operator's keystroke.
- **A failed upload types nothing at all**, and says which half broke. An
  operator who believes a path is in their line will press Enter on it.
- **The server's sentence survives, whatever shape it arrives in.** `/v1`
  documents one error envelope, but the validation layer in front of it has its
  own (`{"detail":[{"loc","msg"}]}`), and both are read, so the phone shows the
  field and the fault rather than a bare `HTTP 422`. The status line is the last
  resort, never the first.

**A dropped write is never silent.** Opening the photo picker hands the screen
to the OS gallery, the PWA goes to the background, and the platform can close
the WebSocket underneath a sheet that still looks attached. A writer that
*guarded* a dead socket and returned nothing would let every caller claim
success.

- **The writer reports.** It returns whether the bytes reached an OPEN socket.
- **The operator's text is the operator's** until the bytes are known to have
  gone. `send()` writes first and clears second. A failed send leaves the line
  exactly where it was, with a sentence; clearing the field is what would make it
  look sent.
- **`delivered` may only render over bytes that actually went.** A photo that
  outlives its socket is **queued** against the next open one and says `saved ·
  <path>` — the upload is the durable half, the file is really on disk, and
  nothing throws it away or lies about it.
- **Detached is a state, not an error.** The sheet says so, offers a `reattach`
  control, and heals itself on `visibilitychange` — returning from the picker is
  precisely the uncovered moment.
- **A reattach never re-types the launch line.** Once per sheet, never once per
  socket — otherwise the double-claude hazard walks in through the back door.
- **Direct tap-and-type is untouched** — same writer, same bytes, nothing added
  between the keyboard and the room. It carries the same sentence, and it is the
  path that needs it most: the terminal echoes nothing back locally, so typing
  into a closed socket looks exactly like typing into an open one.
- A scope-refused UI is disabled *with a visible reason* rather than hidden,
  because a silent refusal is indistinguishable from breakage — and that holds
  when the failure is the client's own transport rather than the server's rule.

**Why these two guards and no others.** The token is the wall: the owner's
laptop, the owner's network, and the server dies when the laptop does. The
confirm tap and the dark-screen check stay because they protect a *thumb*, not
data: a pocket tap ending a live session is a real cost with no upside. Scope
stays because it is the server's rule, not the client's.

The phone draws its own card, `AgentSheet.tsx` — the desktop's `BranchChip`
read back — rather than rendering `BranchChip`, so the desktop card's `readOnly`
flag plays no part on this face. The push hooks (`src/phone/lib/push.ts`) are exported, empty
and inert — a reservation with its gate named, the way `App.tsx` holds the
terminal slot. There is **no service worker**: an offline cache of a live fleet
would show stale aliveness, which is the one lie this system keeps paying to
avoid.

The read lane is fenced on **names, not paths**. The host API takes a branch and
a file name and has no path parameter to abuse, so `transport.http.ts` refuses
an absolute path outright rather than stripping its leading slash and asking for
a branch called `home`.

**Serving.** @api's server mounts `dist-phone/` on its own origin (the zero-CORS
shape), so `npm run build:phone` *is* the handoff — rebuild is deploy, the same
contract the release binary has. There is no artifact to pass and no CORS
allow-list to misconfigure. The page itself is unauthenticated on purpose: a
top-level browser navigation cannot carry an `Authorization` header, so gating
it would mean inventing a second, weaker auth system beside the bearer wall to
protect public code that renders a token door. Every byte of data stays behind
`/v1/*`. The phone reaches it over the tailnet. `npm run dev:phone` proxies
`/v1` from port 1421 for a local build loop.

**BAUD is terminal-agnostic.** AIPass is the backend that does the work, BAUD is
the face that makes it clickable, and the terminal is a component wired into it,
with terminal *selection* intended the way model selection works. Everything
Claude-specific lives on the one launch line in `App.tsx`; the seam names what
BAUD does (`ptyCreate`, `roomKill`, `readFileText`), never one terminal's flags.

Checks, all expected clean:

```
cd app/src-tauri && cargo test      # unit tests; compiling IS the Rust type check
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
every pull request, `npm test` after the type check and before the builds, so a
change that breaks only the phone entry fails. The `rust` job also builds
`baud-cli` with the `gui` feature off and fails if `ldd` shows it linking a GUI
library (FPLAN-0589). After touching the feature gate, run `cargo test` and
`cargo clippy` with `--no-default-features` as well: part of the suite needs no
window, and all of it runs with `gui` on. Two parallel jobs (`frontend`, `rust`)
on a pinned `ubuntu-24.04`, with clippy's warnings denied rather than merely
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
beside it. A test that resolves the real root passes only in a clone that
happens to sit inside the AIPass tree. To check the property by hand, run the
test binary from outside that tree — `cd /tmp && env -u AIPASS_ROOT
<target/debug/deps/baud_lib-*>` — and expect the same green.

The design rule that keeps it so: **a function a test needs to steer takes the
root, or the project, as an argument**. `snapshot_project` resolves the anchor
and hands it to `select_project`, which does the census work; the test builds its
own two-project census in a temp directory and selects against that. A test that
can only call the resolving half is a test that can only be green at home.

### The wheel — the fleet as one flick

The fleet screen is a horizontal rail. Cards scroll-snap sideways, scale from
1.28 at the centre to 0.90 at the edges with an opacity fade, and a green notch
under the middle names the centre as a **place**. Whoever sits under the notch is
the **current agent**, and everything context-bound follows them.

Seventeen agents in a vertical list is a scroll-to-find, and the fleet's whole
point is knowing at a glance who is awake. The rail makes the entire fleet one
flick, and it gives the phone something the desktop does not have: a current
agent at all.

**The approved mockup is the specification.**
`dropbox/wheel_round/wheel_mockup_APPROVED_SHAPE.html` is the specification
rather than a suggestion, so its numbers — 76px cards, 52px avatars, the 1.28
scale, the `.12s linear` transition — are ported literally. Only its hard-coded
hex colours are changed, into `--baud-*` tokens, so the rail follows the theme
instead of freezing one palette into a second source of truth. **An approved
shape spends someone else's decision; improving it silently is not a style
choice.**

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
becoming browser back-navigation — the same species as pull-to-refresh. The
terminal's own guards are untouched.

**One layout.** The rail **persists above the terminal at all times**, so the
operator can observe and look at other agents while a room is running in view;
the terminal is the centrepiece, always there, as on the desktop. Fleet view and
room view are not two layouts; they are one layout whose lower region shows
either the attached room or a resting state. A mockup is evidence about a design
rather than proof of one.

**Browsing is not switching.** Flicking the rail moves the notch, the current
strip and the expand target, and touches nothing else: no socket opens, none
closes, no byte is written. The room below keeps running and keeps rendering
while the operator reads across the fleet — a flick past four cards produces zero
attaches, zero detaches and zero client bytes. When the notch and the terminal
point at different agents the face says so outright (*"the room below stays
attached to X"*), because an unexplained mismatch reads as a flick that failed
to switch.

**Switching is one explicit act, and it happens in place.** Attaching from an
expanded card unmounts the old sheet — whose cleanup closes that socket, which
tmux reads as a detach, so the room survives — and mounts a new one against the
new room. The rail does not move. This mirrors the desk, where clicking another
agent's room switches the tab and the cards stay put.

**`‹ detach` is named for what it does.** With the fleet permanently on screen
there is no "back" to go to, so the only thing that affordance does is close this
client. tmux keeps the session, the agent and the scrollback.

**Reads are overlays.** The reader and the feed render on top of the face rather
than replacing it, so opening a README while attached does not tear down the
terminal or close the room's socket: observing never requires detaching, and the
room below keeps taking bytes.

**The keyboard is the one place the layout gives.** A rail, a room, the chips and
a soft keyboard do not fit. The terminal is the centrepiece and is what the
typing is aimed at, so the rail *compacts* while the compose field has focus —
avatars shrink, names and notch drop, the strip and footer go — and never
disappears. Card **width** is deliberately untouched, so the snap geometry cannot
move: card layout width, rail scrollWidth and scrollLeft are identical across
focus and blur, and the centred card does not drift out from under the thumb.

**The expanded card's stat tiles are doors, not labels** — on the desktop those
same figures are the read affordance. Three of them open `memory`, `dashboard`
and `inbox`, and the agent's **name** is its README door. Before deleting a
container, ask what doors it carries.

The verb chips on the expanded card are a deliberate deviation from the approved
shape: dropping the row would take `end room` with it and strand rooms with no
way to close them from a pocket. `files` browses the branch through the same
fenced read lane the stat tiles use, and `watch` streams @api's read-only
`drone @prax monitor run` instead of opening a window on the desk. Every door on
that row is live.

**The terminal is one seat, and it goes where it is pointed.** It hosts the
agent the operator chooses, whichever project that agent lives in: whether a
branch is an AIPass tenant or external does not matter, because blocking creates
friction. Exactly one door on the expanded card refuses a foreign agent:

| Door | Cross-project | |
| --- | --- | --- |
| README, the four stat tiles, `files`, `passport` | **free** | the read routes take `project` |
| `resume` / `fresh`, `shell`, `wake`, `end room` | **free** | one terminal, any agent |
| `watch` | **free** | @prax scopes itself — see below |
| `settings` | fenced | its route takes a branch and **no** project |

None of the fences is arbitrary. A **read** that names no project resolves under
the seat, so a read aimed at a foreign agent could find a same-named local one
and show its file as this one's; naming the project closes the hazard. The
attach lane is not fenced server-side, so the operate doors need no client
fence either.

**`watch` has no fence and no allowlist.** `monitor run baud` answers *"Live —
scoped to BAUD"* identically from the anchor and from the project's own root, so
the working directory is not the variable. Where @prax genuinely cannot show
something, it says so on the screen the operator is already reading. A live
accurate warning beats a guess at the door, and an allowlist of watchable
projects would only be a second model of @prax's scope, drifting from the first
time they change it.

**`settings` is the one that stays fenced.** It is the only door here that would
not fail loudly: it would open — and let the operator *edit* — a same-named
**local** agent's claude config while the header named the foreign one. A door
that refuses is visible; a door that succeeds against the wrong target is found
later, somewhere else, as damage. It stays shut while that route takes no
project.

**A mounted pane never consults the poll again.** Nothing changes the terminal's
agent except the operator's hands. A pane that re-resolved its card by *name*,
on every render, out of the **seated** project's list would miss for any agent in
the project the header just left, fall through to an empty state, and unmount —
and unmounting a terminal sheet closes its socket, so browsing would drop the
room.

The desktop is immune **structurally rather than carefully**: its `<Terminal>` is
mounted once with no branch prop at all and holds its own room internally, so
there is no lookup available to miss. The phone ports that model into its tab
architecture: a pane carries the card **as it was when the operator opened it**,
and the live poll is never asked about a pane again. There is no *"no longer in
the fleet read"* state, because a room with a tmux client on the other end does
not stop existing when a list changes.

**Unmount happens on exactly three hands, all of them the operator's:** the
attach swap (the one-agent-seat replacement), `end room`, and the tab's `✕`. A
pane whose branch has dropped out of the current read keeps its socket and keeps
typing.

**The pane key is project-qualified, with one deliberate exception.** The host
names a room `baud-<project>-<branch>` and a shell `baud-shell-<project>-<branch>`
— the project is part of a room's identity *on the host*, so a key that omitted it
would describe a room that does not exist. Two projects can hold a same-named
agent, and an unqualified key would make the second one look already open, so
attaching it would focus the first one's pane and leave the operator typing to
the wrong agent under the right name; the project-root shell's key `@project`
would be the same string for every project on the machine. The exception is
global mission control, which names no branch **and no project** on the wire, so
its key names none either; qualifying it by seat would stack identical monitors
as you flicked between projects.

The keys are never written by hand. Every site builds the key through the same
function, so the detach affordance and the close gesture cannot drift from the
pane they name.

**The wheel's avatars carry the desktop's two marks**, from the same payload: a
manager's disc is ringed blue, and a disc with sub-agents running fills red on
the beat. One indicator wearing two sizes, kept visible on both faces together,
because the phone's 44px disc has even more steady colour to hide a pulse in.

**The sheet states the sub-agent count in words**, on the status line rather than
in the counter row. Every tile in that row is a *door* — press `MAIL` and the
inbox opens — and sub-agents have no file to open, so a fifth tile would be a
dead button among four live ones. It is also a different kind of fact: the four
counters are standing figures, this one appears and vanishes with activity.
**Zero is stated, not hidden** (`no sub-agents running`), because a sheet that
renders nothing at zero is indistinguishable from a sheet that does not report
sub-agents at all. The rail says *that* something is running; the sheet says
*how many*.

**The passport opens from the door row, not from the avatar.** On the desk the
avatar *is* the door; here the equivalent disc lives on the wheel, inside the
tap target that opens the sheet, and nesting a second target inside it at that
size would trade the gesture the whole face is built on for a mis-tap. So it
joins `files`, `shell`, `watch` and `settings` at finger size. What opens is the
desktop document's **content and order** at 46 columns, not its layout: the
fields *stack* (label over value, which is how a real passport prints a field
and what stops a Purpose sentence living in thirty characters). The memory tabs
and a manager's monitors live on the card, not the passport — see **The passport
is only a passport** below — and they keep the sheet's idioms: tabs scroll
sideways rather than wrapping to two rows that would change height under the
reader's thumb, and each entry clamps to six lines with the **whole entry** as
the tap target that opens it, because a fleet session summary runs past a
thousand characters, and four of those unclamped is a wall rather than a
document.

Three facts about that document are easy to get wrong. It reads **names, never
paths**: the desk asks for `<path>/.trinity/passport.json` and this face's
transport refuses absolute paths by design, so the phone asks for
`<branch>/.trinity/passport.json` — the shape the stat tiles use. It follows the
**poll**, holding the card's `project/name` ref rather than the card, so a
sub-agent that starts while the passport is open appears on it; and an agent that
leaves the fleet closes its own passport, because a modal that returns by itself
on a later poll is a bug nobody can explain. And a **refused read is printed in
the host's own words** rather than drawn as an empty document — which matters
more here than at the desk, because this face's read lane genuinely does refuse
some branches (see below).

**`traits` arrives in two shapes.** Most passports carry a string; some, such as
@devpulse's, carry a JSON array of sentences. A string-only reader prints an
em-dash over a populated field. The phone reads both shapes and bullets the list;
the desktop reads both and joins them with `·`.

The desktop is frozen as a rule about **findings**, not about files: a defect
this face notices while porting is reported, not fixed on the desk.

**A manager's card carries the monitors** in its MANAGER zone, relocated exactly
as they are on the desk, and both doors are live. The commons feed is `drone
@prax monitor run commons`, a target the watch route names by keyword. Prax
mission control is the desk's *target-less* `drone @prax monitor run` — every
branch at once — and on the wire that is `kind=watch` with **no branch**, which
is the one lane where an absent branch is a real answer rather than the bug that
kills a live session: a watch names no session to take over.

Mission control is never pointed at the `prax` *branch* as a stand-in: that
would render perfectly and be a different view, with an operator reading a
branch monitor as mission control and never learning otherwise. A plausible
substitution is worse than an honest refusal, and it is most tempting exactly
when the wrong answer renders cleanly.

Both monitors ride the **seat**, and that is a choice rather than a fence:
mission control and the commons feed are *this installation's* views, so a
manager card browsed from another project opens the monitors those buttons have
always meant. A watch aimed at a particular foreign branch is a different
question, and the `watch` door on that branch's own card is where it is asked.

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

### The wheel keeps names whole

**The selected card is `transform: scale(1.28)`, and a transform does not change
layout.** The rail is as tall as the *unscaled* card, so the scaled one renders
about 10px past it at each end — and the rail's own `overflow-y: hidden`, which
exists so a vertical drag never scrolls it, would cut whatever lands outside,
starting with the descenders of the selected agent's name. The rail carries
headroom rather than a weaker overflow rule — 11px of vertical padding, taken
back out of the wrap above it so the terminal loses nothing. That number and the
`50vw - 32px` beside it are the same species: **one measurement written in two
places, and both have to move when the card does.**

**The label's own box is a second clipper.** `overflow: hidden` is there for the
ellipsis, and it clips vertically too — at the default `line-height: normal` a
box that size leaves a descender touching its own bottom edge. `1.4` gives the
`p` in `devpulse` somewhere to go.

**The edge cards fade, because the clipping is real and should look decided.** A
rail wider than the screen always has a partial card at each end; sliced
mid-circle with half a badge hanging off, it reads as a layout accident rather
than as *more fleet over there*. A mask fades the outer 26px each way — about a
third of a card, enough to read as a fade, short enough that a peeking card is
still identifiable as one you can flick to. It changes no geometry, no scroll
extent and no hit target.

**Key-bar chips are `flex: 1 1 auto`.** `flex: 1` is `flex: 1 1 0%` — every
slot gets an *identical* width whatever is in it, so the only four-letter label,
`CTRL`, would overflow its border. `flex: 1 1 auto` starts each slot at its
content width and shares the slack, so `CTRL` takes the ~32px it needs and the
arrows give up a few they never use. Clipping with `overflow: hidden` would show
a chip reading `CTR` — a control that lies about which key it sends is worse than
one that is a few pixels wide.

**Selection on a touch screen** rests on four mechanisms: the forged shift-drag,
the second-finger guard, the `contextmenu` prevent, and the ResizeObserver hold —
a fit mid-drag drops the selection, so a drag holds the observer off and pays the
fit out on lift. Copy and clear sit in a plain row: without them a selection is
text a thumb can highlight and never use.

**The PWA manifest and the sign-in door describe both scopes.** `read-only` is a
property of the **token**, not of the face, and the sign-in door is shown before
either token is known, so both say what is true of both scopes; the header's lock
chip says which one arrived.

### The passport is only a passport, and the workbook got a door

**The passport is a pure identity document**, `passport.json` rendered as a
document and nothing else. Every live fact, every count, every door and every
verb belongs to the agent card. One home per fact; nothing renders twice:

| fact | where it lives | why |
| --- | --- | --- |
| working memory | the card's `memory` door — its own screen | four files the agent rewrites daily are the opposite of an identity document |
| the two manager monitors | the card's MANAGER zone | operational doors, and a passport has no operational doors |
| the sub-agent count | the card's state line | it is a live number |
| `class` | the passport's holder block, beside the name | which is where a passport prints it |

What the document keeps is the document: holder, role, purpose, traits, when it
was issued and under what number, the principles the agent declares, the
**stamps** it has earned, and one door to the official records behind it.

**The memory screen is a screen, not a sheet**, which is the files idiom rather
than the passport's: full height, one `‹ back`, sticky head, four tabs of
thousand-character summaries — the two `.trinity` files, the by-name lane, and a
reader that copes with four containers written by four different hands.

### The birth certificate, drawn as the document it is

Every other file on this face opens in the Reader as text, and that is right:
BAUD does not know what a report or a plan *means*. It does know what a birth
certificate means — @spawn writes exactly one, at exactly one name, with a stable
shape — so the one file in the fleet that is a **document** gets drawn as one,
behind the passport's records door.

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
text *is* the honest render of a file that does not carry a certificate. Real
certificates in the fleet include zero-byte files and files that are literally
`{}`.

The certificate's path is **one constant** shared by the renderer and the
passport's gold `ADMIN GRANT` stamp, because that stamp's only evidence is the
signed certificate itself — not a field on the passport, not a flag in the fleet
read. Two copies of the string is how a stamp and its document drift apart.

### The git app — the fourth layer is not an agent

Every other door on this face is addressed to somebody — a card, a room, a
passport, a memory — and **the repository they all live in belongs to nobody**,
so it has nowhere to hang on a rail made of citizens. The wheel has a fourth
layer for surfaces that belong to the project rather than to anyone in it:
`current project`, `live`, `dispatched`, **`apps`** (DPLAN-0303).

The layer is one row in the array, one pip, one flash — but it has a second
**card shape**, because *a surface* and *a citizen* must be one glance apart:
apps are rounded squares in ember orange, agents stay circles in fleet green, and
the accent travels through the pips, the notch and the flash together so arriving
on the apps layer reads as one move rather than four. An app card carries **no
`data-name`**, so the centre report that drives the terminal, the sheet and the
whole context-bound half of this face never fires on it: flicking down to look
at the repository leaves the agent you were talking to exactly where it was.
There is no lane behind the list and there should not be one — an app is a
surface this face itself provides, so a server that has never heard of it can
neither add one nor take one away.

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

**Two grains, one app.** The card's `GIT` tile opens the same grouped list
narrowed to that one citizen's working tree. So the grain is a **prop, not a
second component**: a copy of these screens scoped to a branch would be the same
four reads, the same refusal voice and the same grouping rule written twice, and
the second copy is where the two start disagreeing about what a changed file
looks like. The grain changes exactly three named things — which floor the stack
starts on, what the changes screen asks for, and how deep a group cuts (three
path segments at repo grain, where this fleet keeps its branch roots; one at
branch grain, where the root is already stripped). Grouping is presentation and
nothing else: it never adds, drops or reorders a row. A repository laid out
differently gets uglier headings and the same complete list.

**Divergences from the mock, each one upstream and named rather than faked.** The
patch renders with **three** lines of context, not the mock's one, because the
lane routes through drone's own door and that door recognises no `-U`
passthrough. The commits list carries **two short rows, not four fields**,
because the log door runs `--oneline`: an abbreviated name and a subject, no
author and no date. They are one tap away on the commit itself, where one read
answers for one commit. And the list is **always the whole repository** — that
log door runs from the repository root with no pathspec, so *"commits for
devpulse"* would be a straight lie about what was measured.

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
box in somebody's basement. A remote with no browsable form (a directory on
this disk) answers `web: null`, and the screen shows the remote and says there
is no page to open, rather than drawing a link to nowhere; no remote at all is
covered under the git app's refusals below.

**The badge is its own lane, and a much slower one.** The per-branch sweep walks
the fleet one card at a time; the app's badge is **one** call for the whole
repository, and it is the most expensive read this face makes — a status over a
tree with seventeen branches in it. Two minutes between reads is well inside the
scale a repo-wide count moves on, and it makes the number a background fact
rather than a poll.

### The FILES app — the fence learns more than one kind of word

The apps layer's `FILES` card (FPLAN-0443) sits beside `GIT`, second entry in
the same array, and opens a file explorer over home, the projects and the AIPass
root as well as the agents. `FilesScreen` is a phone file manager — one level at
a time, an up chip, a Reader on the other side of a tap, status chips riding the
rows. It can stand outside a citizen's directory because **the fence answers more
than one kind of word**, not only a branch name; the browser, the splitter and
the Reader are the same components at every floor.

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
exactly where a branch name sits. So the splitter, the browser, its up-chip and
the Reader need nothing new — the only addition is the kind, and it rides as a
key that is omitted unless a caller names one. Absent means the branch meaning
these routes have always had, character for character. `/v1/dir` echoes `root`
back in its answer.

Every root names its first component, including the ones that name nothing:
`home` and `aipass` stand in for themselves. That is not decoration — `branch`
is a **required** query field (`422` without it), and an empty first component
would build a leading slash the transport refuses by design. One expression in
one place, so nothing downstream has to know which kinds carry a name.

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
plain, and **no banner says anything is missing**: an unpainted row claims
nothing, where a row painted clean would claim the file is unchanged. Never a
false clean.

**The desktop refuses the roster by name.** There is no Rust command behind
`list_roots` and there should not be: the desk browses the project it is seated
in, from a machine with a file manager three feet away. `transport.ts` says so
in the mirror table, so the name fails as a designed absence rather than as
tauri's *command not found*.

**The exposure, kept where it can be found.** With a `home` root, a
**read-scope token reads `~/.ssh/`, `~/.aws/`, `~/.gnupg/`, dot-env files and
`~/.claude/settings.json` from the phone over the tailnet.** A read token is not
a harmless mirror of the file lane. The posture is deliberate (full operation
first), and nothing here forecloses narrowing it: a name deny-list in the
server's read module, or an operate gate on the home arm alone.

### The backup app — the store, and four presses that add to it

**The third card on the apps layer**, `BKP`, after `git` and `files` (DPLAN-0411).
A project's backup store belongs to nobody in it, which is why it sits on the
apps layer. The card carries no badge. Tapping it opens
`phone/backup/BackupApp.tsx` over the stage, for the **seated project** (the
header chip's name, the same value the git app gets); `‹ wheel` closes it.

**What the store holds**, read from `GET /v1/backup/status`: one line per lane,
*Snapshot · 2h ago · 15,414 files*, *Versioned · 18d ago · 4 files*,
*Drive · never*, using the face's own age words, plus the project's Drive sync
setting, on or off. **sizes** re-reads with `sizes=1` and adds the two store
sizes. It is a chip rather than part of every read, because walking a large
store takes seconds. These lines come from @backup reading its own store on disk,
so they survive a server restart that forgets every job.

**Four click options:** **Snapshot now**, **Versioned now**, **Full backup** and
**Sync to Drive**, which are the lanes `snapshot`, `versioned`, `all` and
`drive_sync`. Each press is `POST /v1/backup/run` and answers at once with a job.
While anything runs, the sheet reads `GET /v1/backup/status` every 2 s, while the
screen is looked at. When status no longer lists the press, the sheet reads
`GET /v1/backup/job` once for the outcome, shows the command's own last lines
verbatim, and re-reads the status. The other presses stay live while one runs,
since @backup decides what overlapping lanes mean. A sheet opened mid-run adopts
every run from status's `running` list.

**Stop and progress** (DPLAN-0412). The running list comes from @backup's own
running files, so it carries runs started from a terminal or by the daemon as
well as the phone's, each with its pressed `verb`, the `lane` at work and a
`progress` object.

- **A listed press reads Stop**, in the accent outline, with no confirm, because
  stopping is the safe direction. It POSTs `/v1/backup/cancel {project, lane}`
  with the pressed verb (`all` stops the whole cycle) and shows @backup's answer
  verbatim (`stopped drive_sync (pid 175450)`). A 404 `not_running` means the run
  ended between two reads, so status is read again. A read token is refused the
  Stop by name, as it is every run. A press the phone holds a job for that status
  does not list yet shows `· running…` and does not fire.
- **One progress block per running entry:** the press's name (under Full backup,
  the sub-lane at work with its counts: *Full backup · versioned · 300 / 15,491*);
  a bar, which is a real `<progress>` and is indeterminate while the lane scans;
  the line *1,204 / 15,414 files · 310 MB of 2.9 GB · 2m 10s* (bytes in @backup's
  own 1024-based words, *of …* only when the lane knows its planned bytes, elapsed
  from `started_at`), or *scanning…* while `progress` is null; and the tail of
  the file in flight in the mono face. The progress line ends with *· N failed*
  when the lane's `progress.failed` is above zero.
- **Stopped** is its own outcome word, in the dim colour rather than red, over
  the summary verbatim (*stopped by request: 1,204 of 15,414 files, 310 MB*).
  Done is green, failed red.
- **A run that refused before uploading anything** leads with its own sentence.
  When a failed job's summary ends in a line ending *Nothing uploaded.* (Drive
  headroom: *Drive has 1.4 GB free; this run needs 2.9 GB. Nothing uploaded.*),
  that line is the headline and only the lines above it stay in the block below.

**The two presses that can send files off the machine ask once:** Sync to Drive
always, and Full backup when the Drive setting is on (or not known). The confirm
is the kill verb's dialog shape and the face's manners only: the server is not
told a human confirmed, because it would not honour that. A read token sees the
status and is refused every press by name. The server's sentences (a 400
"already running", any 503) are shown as they came. A 404 for a job the server
forgot (it restarted) sends the reader to the status lines, which hold the run's
outcome.

**Which project, and what it holds.**

- **The head names the seat and shows its root.** The title is the seated
  project's name, and once a status answer has landed, the line under it is the
  answer's `root`. @api echoes the asked `project` verbatim, so `backupHead`
  shows a root only from an answer whose `project` is this seat. The sheet is
  keyed on the seat as well, so a header project switch starts again from the
  name alone and the old seat's path is never shown under the new name.
- **No project seated** says *no project is seated yet* in the status block,
  instead of *reading the store…* with nothing to read.
- **A root with no `.backup/` store** (`registered: false`) leads the status
  block with *this project has no backup store yet — register it with drone
  @backup register <root>*. The lane lines read *never*, and the presses stay
  live because @backup decides what a press on an unregistered root does.
- **A run started elsewhere shows up.** While no run is in flight, the sheet
  reads status every 10 s, through `whileVisible`, so a closed sheet or a
  pocketed phone reads nothing; `whileVisible` ticks at once, which is the read
  on open. Once status lists a run, the 2 s watch takes over. One tick runs at a
  time across both.

**The desktop does not have it.** `transport.ts` refuses `backup_run`,
`backup_job`, `backup_status` and `backup_cancel` by name, because the desktop
sits beside `drone @backup` in its own terminal. Every wire shape is pinned in
one place, `src/aipass/devpulse/docs.local/backup_door_contract.md` in the AIPass tree.
`types.ts` mirrors it field for field.

### The monitor row — the machine, live on the face

The wheel's last layer is the machine (FPLAN-0561; every clause ruled in
DPLAN-0341). Seven cards — CPU, MEM, TEMP, FAN, NET, PROC, BAT — each carrying its
live headline, because the glance is the point: a fan running hard behind a
locked screen across the room is the case the row answers. BAT, last, reads the
battery section of `/v1/machine`, tones only against the low and critical lines
the host publishes, and a host with no battery draws the dash.

**Three owners, one piece each.** @skills publishes `machine_vitals()` and owns
every meaning in it — which sensor is the CPU, which rows are nonsense, what an
absence is called. @api proxies it verbatim on `GET /v1/machine` behind a 1 s
single-flight cache. BAUD draws it and decides nothing else. There is no Rust
half: `sysinfo` has no fan API at all, and psutil reads the fan. The desktop has
no command behind `machine_vitals`, and its transport refuses the name out loud
rather than failing at the IPC.

**The faces.** CPU and MEM draw their percent with a ring of the same percent.
TEMP draws the package °C with a ring of celsius over the sensor's own
`critical`, amber from 85% of the sensor's `high` and red at `high` itself (both
lines are 100 °C on the MacBook this was built on). FAN draws the percent of its
range with the ring; a fan with an rpm but no range (`no_range`) draws the rpm
and no ring. NET (sent plus received, per second) and PROC (a count) have no
range and never wear one. Colour belongs to the readings that publish a line to
be warm against: the temperature (its sensor's `high` and `critical`) and the
battery while discharging (UPower's low and critical lines, when the host has
them). The ring sits inside the card's border, because the centred card's scale
already spends the rail's vertical headroom and an outside ring would be cut off
on exactly the card being read.

**Absence is not zero.** A section the host cannot give draws a dash — and on a
gauge a dead ring — and its sheet prints the skill's own sentence for the reason,
with the detail when there is one. `warming`, the first read after the server
starts, has no CPU or network window yet and renders the same way. A 503
(`psutil_missing`, `switched_off`) turns every face to a dash and the sheet
prints the owner's message.

**The cpu page shows the cores** (FPLAN-0586). One bar per online CPU in the
skill's `cores` list — never one per configured count, which can differ — then
one line of what the machine has (*4 threads on 2 cores · 1.1 GHz, up to 3.3*),
then the three load averages with a caption saying what they mean against the
live thread count. The sample window rides the sampled line. While the section
is warming the bars give way to the skill's sentence, never to zero-height bars;
any count or clock the host cannot give prints a dash, and a missing clock's
reason (`detail`) sits under that line.

**Read while looked at, and only on that row.** `lib/machine.ts` polls every 2 s
— past the server's 1 s cache, so every read is a fresh sample — through
`whileVisible`, and only while the monitor row is the visible wheel. Leaving the
row stops the lane and forgets the reading, so arriving again shows bare marks
until a fresh answer lands rather than last visit's numbers dressed as live ones.
The sheet opens over the wheel without moving its layer, so it stays live. The
route takes no query parameters, ever — a cache-buster included. PROC's sheet
lists what is running, by cost — see **What is running, and rooms that end**
below.

### A path you can hand to someone

Every row the files screen paints — a file, a directory, and the row for a file
git says is **gone** — carries a **copy** button, and so does the reader's
header, because half the time you are already inside a file when you want its
name. It copies the **machine path**.

**Why it has to be the machine path, and why that needs the server.** Every
path this face sends is a *name*: `<branch>/<relative>`, resolved by the server
against a floor the phone never learns. That is exactly right for asking and
exactly wrong for handing to a person — a relative path pasted into an agent's
prompt resolves against wherever that agent happens to be standing, which is a
different tree often enough to matter and is never flagged when it goes wrong.
So `/v1/dir` and `/v1/files` carry one key, `floor`, the absolute path of the
resolved root, and `app/src/phone/lib/copyPath.ts` puts the relative back on the
end of it. **No floor, no copy:** the button answers *"the server did not say
where this root stands"* under the row rather than handing over half an answer.
A floor of `/` joins without a double slash (a plain `filter(Boolean)` join
would build `//notes.md`); the measured cases are in the function's own doc.

**The lane that exists because of the device it runs on.** This face is served
over plain http on the tailnet, and `navigator.clipboard` is **undefined in an
insecure context on Android Chrome** — the exact browser this face exists for. A
copy button written against the modern API alone works on the desktop and does
nothing at all on the phone, silently. So the legacy `document.execCommand`
textarea lane is not a fallback for old browsers; it is the only lane on the
device that matters, and the modern one is the courtesy. The order is
**synchronous-first** on purpose: `execCommand` only works inside the gesture
that asked for it, and awaiting a promise ends that gesture, so the absent-API
case never awaits anything.

**Nothing is assumed to have worked.** Both lanes report — the promise resolves
or rejects, `execCommand` answers a boolean — and the button shows `copied` only
on a confirmed copy. A tick that appears whether or not the text moved is worse
than no tick, because it is the operator's only way to know. The mark does not
time out, either: the clipboard has no timer, so a tick that faded after two
seconds would be claiming an expiry that never happened.

**What the layout costs.** A button cannot contain another button, so the row is
a flex line of three things — the name, the copy button, the status slot — and
the status chip sits outside the tap target at the row's outer edge. Tapping the
17px chip does not open the file; tapping anywhere else on the row does. Every
row reserves the chip's 17px whether it has a status or not, so the copy button
lands in one column all the way down the listing instead of stepping sideways on
every unchanged row.

### Nothing polls a pocket

**A poll only runs while somebody is looking** (DPLAN-0305). Every repeating lane
— the fleet and roster snapshot, the wheel's per-branch git sweep, the bell's
badge, the git app's repository count, the feed screen's own poller — starts
through `phone/lib/whileVisible.ts`, which stops the interval on
`visibilitychange` and restarts it, **with one immediate tick**, when the screen
comes back. The tick on wake is what makes the gate safe rather than merely
cheap: a lane that only paused would hand back a wheel frozen at the moment the
phone went into a pocket, where this hands back a wheel read at the moment you
looked at it. **`whileVisible` holds the only `setInterval` in the phone face**,
so every repeating lane on this face is gated by construction rather than by
discipline.

*The browser's own background throttle is not this.* A hidden tab's timers are
slowed to roughly once a minute — a courtesy, not a contract, differing by
browser and not applying to an installed PWA the same way everywhere. Slowed is
not stopped, and the host serves these on one event loop with blocking work in
the handlers, so a request nobody will ever see is a slice of that loop the
terminal's websocket does not get.

**The badge asks with the cursor.** The bell polls the feed with the same cursor
the feed screen uses: about 228 bytes an ask, against about 23 kB for a full
hundred-event window. The merge rule that makes a cursor safe — the server
re-delivers the boundary event on purpose, at-least-once, because a dropped alert
is worse than a duplicate — lives in `phone/lib/feed.ts` so both readers fold one
feed the same way. A badge and a list that count differently is the phone telling
two stories about one feed.

**Badges build no lists they never read.** The wheel's sweep and the git app's
repository badge ask through `git_change_count`, a third name on
`/v1/git-changes` that unwraps to two numbers. The rows still cross the wire, but
nothing is materialised here for a number to be lifted back out of. The
repository badge is `count + untracked`, which is the same number as
`len(rows)` **by construction and not by coincidence**: the server appends every
changed path to `rows`, counts the untracked ones separately and puts the rest in
`files`, and `count` is `len(files)`. There is no cap on either side for them to
drift through.

**The intervals are operator-visible calls, not performance knobs.** `POLL_MS`
(10s) and `GIT_SWEEP_MS` (5s) set how stale a wheel is allowed to look.

**The machine lane is gated twice** (FPLAN-0561). It goes through `whileVisible`
like every other lane, and also only runs while the monitor row is the visible
wheel — the wheel reports its layer up, and leaving the row tears the lane down
and forgets its reading. So the one lane on this face that polls every 2 s costs
nothing on any other layer, and nothing in a pocket.

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

### A reload that actually reloads

The header name reloads the face, and it must never serve a **stale** one. A
response with no explicit freshness lifetime may be cached heuristically — the
usual browser rule being a tenth of the age since `last-modified` — and the
entry document names the content-hashed bundles, so a stale entry means the
browser faithfully fetches yesterday's bundle. The assets are safe by
construction; the entry that names them is the hole.

Two halves close it. @api serves every stable-named bundle-root file
(`phone.html`, the manifest, the icons) with `cache-control: no-cache` and
answers conditional requests, so the browser keeps its copy and revalidates it
(a matching `etag` comes back 304); `/assets` is the hashed lane and is cached.
And the reload re-reads the entry over the network first (`cache: "reload"`,
which fetches from network **and** updates the HTTP cache) before navigating.
The client half is deliberately best-effort: if the network read fails the
reload still happens, because a refresh button that refuses to refresh is worse
than one that occasionally refreshes to the same bundle.

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

### A dead room says so, and comes back by itself

*FPLAN-0446.* A detached room goes on painting its last frame, because that is
the only thing a terminal emulator can do once the bytes stop — and that frame is
**indistinguishable from a quiet room**. The picture is what lies, so the
correction sits **on the picture**: a scrim over the grid, the word `detached`,
and the door in the middle of it, rather than a line above the grid you can
scroll past. The stale frame stays legible underneath on purpose — it is the last
true thing the room said — but it can never pass for now. Zoom and fullscreen
keep working through the scrim, because reading that last frame is exactly when
somebody wants it bigger.

Three states hide behind "not attached" and they get three sentences, not one:
opening for the first time (no frame has ever arrived, so no scrim), attached
and then dropped, and never got in at all.

**Why the phone needs liveness of its own.** The other end has it and uses it:
uvicorn pings every 20s and hangs up on a pong that does not come back inside
20s. A browser has no ping API at all — the protocol's own ping/pong is answered
down in the network stack, below JavaScript, and never surfaces — so the room
can be torn down on a clock this side does not share. **The side with liveness
kills the side without it, and the side without it paints the corpse.**

Two lanes, and the phone **feature-detects** which one it is in rather than
coupling to a server version:

- **The real round trip.** One `{"type":"ping"}` per socket; a `{"type":"pong"}`
  text frame back means this host has the lane, and from then on liveness is
  measured — a ping every 10s, dead if no answer inside 30s. Exactly one probe,
  never a retry loop: a host *without* the lane writes a warning line for every
  unknown control frame (and keeps the socket open), and a keepalive that fills
  somebody else's log is a bug wearing a fix's coat. @api's pump answers `ping`
  with `pong` and nothing else.
- **The silence guess**, when nothing answers: **90 seconds** with no bytes at
  all. An idle agent room is not silent — tmux redraws its status bar — but only
  when that bar's *text* changes, so the gaps are long and uneven: on a live idle
  room the longest gap between bytes measured **29 seconds** inside a 62-second
  window. A watchdog at 15s would execute a healthy room about once a minute.
  Three times the worst measured gap is the margin, and the cost of being wrong
  in this direction is one reattach.

When the watchdog lets go of a socket it says which lane did it: "the room
stopped answering" on the pong lane, "no bytes from the room for 90s" on the
silence lane.

**Coming back is a ladder, not a poll.** The retry runs while the screen is up:
immediate, then 1s, 3s, 6s, 12s, 30s (`RECONNECT_MS`), and then it **stops and
says it stopped**, because a room that has refused six times running is gone
rather than slow, and the honest answer to gone is a button rather than a wheel
that turns forever. Looking away and back resets the count; the button always
works.

The rungs exist because **retrying is not free**. These rooms are opened
`window-size smallest`, so every attach drags the desk's window down to the
phone's columns and bills the other end for a full repaint — 5392 bytes for a
one-column change. So the foreground edge opens no sockets on its own (one lane
decides, and it is watching that same event), a handshake already in flight is
never overtaken by a second one, and a socket that comes back while a rung is
ticking stands the rung down. The lane never opens over a `CONNECTING` socket;
it re-checks an in-flight handshake every 1 s without counting it as a try. It
does not check which tab is in front, because every open pane stays attached on
purpose, so N dead panes cost at most N×6 attaches per look.

Nothing here runs in a pocket. The watchdog stops when the screen goes away and
starts again — with the clock reset — when it is looked at, because the question
it asks is how long the room has been quiet *while somebody was watching it*.

**An ended room stays ended until the operator resumes it.** A room that
reconnects by itself could undo the operator's own gesture: @api attaches with
`new-session -A` — attach-or-*create* — so a retry into a room that `end room`
just killed does not fail; it builds a new empty session wearing the dead room's
name. So the client goes when the room goes: the chip fires on the **machine's
answer**, never on the request leaving, and a kill that was refused leaves the
room alive and the tab open. Only that tab — `end room` ends the *agent's*
session, and the branch's shell (`baud-shell-*`) is a different one that
survives it, so closing more would be this face inventing an outcome the verb
never had. The sheet itself stays open, because the chip's sentence is the only
confirmation the gesture landed.

### Git rides the row it belongs to

*DPLAN-0303.* The files screen paints status onto the listing it already has:
**a changed file is painted, never moved, never grouped, never lifted out into a
second screen.** The one row this adds is a file git says is *gone* — absence you
can see, in the place the file sat. A directory row wears a dot when
anything beneath it changed, so a level points at where the next tap goes instead
of making you open folders one by one to find out.

**The whole vocabulary, not half of it:** green new, red deleted, amber edited,
as git shows them in an editor, and changes behave as git's do. The rows lane
carries git's own two-column code per path and untracked files **by name**, so
the screen reads the status instead of inferring one — and it reads it through
the same mapping the git app's file rows use. One mapping, one set of colours, so
a file cannot read as *new* here and *modified* one screen along.

That mapping lives in exactly one file, and its precedence is deliberate and not
alphabetical: **deleted wins** (a file that is gone is the one status where
acting on the row is impossible, so it must never hide behind a second letter),
then untracked (`??`, which has no columns and never appears beside anything),
then added **from the index column only**, then everything else is modified —
renames, copies, type changes, unmerged pairs, and any code nobody anticipated.
A row is never dropped for wearing a letter this face has not met. @api sends the
code **raw and unstripped** for exactly this reason: `A ` and ` M` are different
answers that collapse into one the moment either is trimmed, and a letter
invented here would be a second vocabulary for a fact git has already stated.

### One gear, two owners' files

The header gear opens **one** surface, and the sections sit inside it — the
interface panel and @memory's dials are two owners' config, and a second gear is
how an app ends up with two places called settings. On the desk it is a sectioned
dialog; on the phone, a list of rows. A thumb navigates a screen at a time and a
pointer does not need to.

**One implementation, two placements.** `InterfaceSettings` exports the rows
(`InterfaceControls`) and the rows wearing their own scrim and title bar — the
desk mounts the controls inside a dialog that already carries chrome, the phone
mounts the whole panel on top of its own. A title bar drawn twice is the only
thing that split exists to prevent, and there is exactly one implementation of
startup agent, poll cadence, bell and hook sounds, and one of the memory dials.

The phone's settings screen has a preference the desk does not: **terminal
scroll speed**, a thumb's problem. The knob scales the terminal's pan
acceleration, so `3` is the baseline the percentage is a percentage *of* — an
absent key computes exactly the baseline. The knob runs from 50 to 400, with
100 as neutral. The field is on the shared document so
the desk can grow a control for the same key without a migration.

### The startup seat, and why it needs a different store

The startup agent set in BAUD settings is seated on every open of the phone,
including a refresh, as it is on the desktop.

The seat spends **one shot per page load**, and the store is the entire
difference between the two faces. The desk spends its shot in `sessionStorage`
because its *app run* outlives a React remount — `npm run tauri dev` **is** the
operator's seat, so every frontend save hot-reloads `App`, and a ref-held guard
would re-arm and resurrect a room the operator just ended. None of that is true
here: the phone ships a built bundle with no HMR, and its refresh is a **tab
reload**, which `sessionStorage` deliberately survives. Borrowing the desk's
store would arm the shot exactly once per tab, ever. Module scope dies with the
page load, which is what *once per open, every open* actually means in a
browser.

It also needs a second flag. `scope` is `"read"` in three unrelated situations —
a genuinely read-scoped token, an answer that failed, and **the first frame of
every returning arrival**, before `whoami` has been asked. Every other consumer
is happy with that conflation, because for a verb chip all three mean the same
safe thing. The seat is the one consumer that must tell them apart, and it is not
a race that *sometimes* happens: child effects run before the parent's, so the
fleet is asked for first, and `/v1/fleet` shells out to `baud --snapshot` without
awaiting — it holds the event loop for the whole read, so the fleet **always**
lands first. Gating the seat on `scope` alone would fail every time.

### The feed can clear

The feed has a clear button, on the desktop bell's model: a **cleared-up to**
timestamp held by the face, and everything at or older than it stops rendering.
**Display only** — the feed file is never touched, BAUD is a reader and ai_mail
is the feed's only writer, so there is no host call here to make.

**Two markers, not one.** *Read* moves by itself when the screen closes;
*cleared* only ever moves when the operator taps clear, and it is the one that
stops an event rendering at all. They live together one level up, beside the
unread count, because the **badge** has to obey the cursor too: a badge counting
three events over a screen that shows none is the phone telling two stories about
one feed. And the button is **absent** rather than disabled when there is nothing
to clear — this face's own rule, because a disabled button on touch has no hover,
no title and no answer.

**One bell for the machine** (`lib/feedMarks.ts`). `/v1/feed` takes no project,
so there is one feed, and the read and cleared markers are one key each:
`baud-phone-feed-read` and `baud-phone-feed-cleared`, whichever project is
seated. A project switch does not bring read events back as unread, and a clear
clears the feed everywhere. A phone with no machine-wide mark adopts the seated
project's per-project mark (`baud-phone-feed-read:<project>`) once; after that
the machine-wide key always wins. The desktop bell keeps its own per-project
keys.

### Designed reads, and reasons said out loud

**Three tiles open designed reads, not raw JSON.** The memory screen is the
pattern: read the agent's own file through the named-file lane, parse it on the
phone, draw a list. No new route, because @api is a gateway (compass #293).
**MAIL** opens an inbox screen over `.ai_mail.local/inbox.json`: newest first,
sender, subject, age, an unread mark, and a "N unread · M total" head; a tap
opens the message's **full text**, wrapped, under its subject, sender and time.
`reply_path`, `sent_id` and `auto_execute` are never drawn. **PLANS** opens a
plans screen over `DASHBOARD.local.json`'s flow section: the active count, the
open plans and the recently closed ones, each list stating its own absence. A
plan row is a card with no button inside, because this screen cannot open the
plan file. **TODOS** opens the memory screen on its todos tab.

**The MAIL tile reads "N new · M opened"**, always both halves, so the tiles add
up to the rail's badge, which counts opened mail as waiting. The figure is words,
so the tile takes a wider share of the row in a smaller face.

**The bell row is a door to its message.** A mail notification's body is a
100-character preview, and it stays one: the feed is read whole on every poll and
is the wrong store for whole letters. Under contract C-A (devpulse's
`docs.local/baud_review/CONTRACTS.md`) @ai_mail stamps `mail_id`, `recipient`
and `project` into the event, and a row carrying them opens that message in the
recipient's inbox screen; back lands on the feed. With `project`, that project's
inbox is read directly; an event without it finds the recipient in the seated
census first, then the roster. A message the inbox no longer holds says so in one
line. Rows without the keys stay plain.

**Markdown is drawn.** A `.md` file — the README behind the card's name first —
goes through the Reader's `render` door to `marked` (18.1.1, pinned; about 14 KB
gzipped). Raw HTML in the file is shown as text, only absolute `http(s):` and
`mailto:` links are live and they open in a new tab, and images are drawn as
links rather than fetched. An empty file says *this file is empty*.

**Settings › About** shows the version and bundle rows.

**A title is not a reason on a phone.** Touch never shows `title`, so every
reason is also a small visible line in the verb chips' answer voice; the titles
stay for the desk. Under a read token the room doors say why they are quiet. The
header lock chip prints what the machine answered, or its refusal, under itself.
The GIT tile's `n/a` prints @api's sentence, a refused manager monitor prints its
hint, and an empty cross-project wheel prints the roster's reason under its short
word. A tap on a passport serial shows the full id. **`▸ resume ⚡` confirms on a
second tap**: its INTERCEPT sentence shows under the doors, the first tap arms the
door (amber, "tap again"), a second tap within four seconds stops the working
agent and resumes its chat, and any other tap on the card disarms it.

**The live and dispatched wheels say "reading…" on a cold load.** Every failed
roster read records a refusal, so a missing roster with no refusal is only the
first read still out. "lane pending" (the route is not live) and "roster
unavailable" (with its reason) come from the refusal.

### What is running, and rooms that end

**The PROC sheet lists the top twenty**, a quick reference for what is using the
machine when the fan runs and no agent is. The headline is every process the
host counted, sleeping ones included, so it says "processes", never "running".
Under it, @skills' `machine_processes()` through @api's `GET
/v1/machine/processes` (contract C-B): the twenty busiest by cpu
(`PROCESS_LIMIT`), each with cpu %, memory % and resident MB, and a cpu/mem
toggle that re-orders the same twenty on the phone. **Read once** when the sheet
opens and again on a tap on the sampled line, never on the monitor row's
two-second cadence and never while the sheet is shut: the skill sleeps about half
a second to sample cpu honestly, and the line says "sampling…" while it does. A
refusal shows the server's sentence, as the vitals refusal does. A process that
came back with no name shows its pid. The desktop refuses `machine_processes` by
name.

**A closed socket says which kind of close it was** (`lib/socketClose.ts`, shared
by the room and the watch):

- **4000 "room ended"** (contract C-C): the tmux session ended under the socket,
  from the desk or a shell that exited. Final. The room's overlay reads "ended —
  this room is gone; open it again from the card to start fresh", with no
  reattach button and no ladder, because `new-session -A` would build a fresh
  empty room under the old name. An agent room's ended mark is written, so the
  startup agent does not recreate it. A watch reads "the watch ended" and does
  not re-arm; its rewatch button stays.
- **1008 / 1011 after accept**: the host refused (an unknown branch or project,
  no tmux). Final too. The overlay says "refused", the host's sentence stays in
  the error line, and a hand on the button tries once more.
- **anything else**: a detach, a pocket, a dropped link. The ladder runs (0, 1,
  3, 6, 12, 30 s while visible).

The ladder's count resets, and the launch or help line is typed, on the room's
**first data frame**, not on `onopen`: @api accepts before it refuses, so an open
socket alone proves nothing. A token refused at the handshake keeps the
`onerror` sentence instead of being overwritten by an empty close.

**`end room` is remembered.** The verb's success writes `intent.ts`'s ended mark
(the desk's own store), the startup agent's guard reads it, and the card's
attach doors clear it - the one door that revives an ended room, as on the desk.
The marks live in `localStorage` under `baud.rooms.ended` as a list of
`"<project>/<branch>"`, and corrupt storage reads as empty.
When the startup agent does not open because the token is read-only or the
agent has no card in the seated project, the resting stage says so in one line:
"startup agent X not opened — reason". The header ring follows the agent room
(the seat pane), not whichever tab is in front.

**The watch dies like a room.** A dropped watch dims its last frame under the
room's own overlay and climbs the room's ladder; a watch holds no state, so a
reconnect costs one fresh observer. The button reads "rewatch mission control"
for the target-less monitor and "rewatch <name>" otherwise, and it shows only
after a close - never while the first connect is still going.

### Settings that tell the truth

**Settings › memory says only what the phone can know.** The panel is the
desk's own (`desktop/MemorySettings.tsx`); the phone's difference travels as
data, and the words for it live in `src/memoryCopy.ts`, pure and tested. The
phone's `/v1/memory-config` reports neither the config file's path nor the
enforcement hook's state, so the transport hands up `path: null` and
`enforced: null`. The panel draws no path row for a null path and no "enforcement
is OFF" warning for an unknown flag; the warning shows only on a `false` somebody
read. The phone has no character-caps lane (the route serves the rollover dials
only and the caps write is refused), so it passes `capsAtDesktop` and the caps
section reads "character caps are set at the desktop" and nothing else. The
desktop never passes the flag: its caps sentence stands, even over an empty list.
The push confirm names the count of branch overrides when there are any and
says "this resets every branch to the defaults" when there are none, on both
faces.

**Three interface rows are the desktop's.** The phone polls at its own fixed
`POLL_MS`, keeps `FEED_KEEP` events and has no chime, so "poll every", "bell
keeps" and "bell chime" change only the desktop. The interface door on
settings home says so: "poll every, bell keeps, bell chime apply to the desktop
only". They are not wired on the phone.

**Per-agent limits are the card's gear.** The memory screen's foot reads
"limits: fleet defaults — settings → memory · per-agent limits: this card's
gear": the gear writes an agent's own limits through `/v1/memory-config/set`.

### Files that keep their place, and a git app that says why

**`copy` and `copy path` say "copied" only when the clipboard confirmed it.**
Both buttons (a browse row's `copy`, the Reader's `copy path`) go through
`copyThrough` and `copyShown` (`lib/copyPath.ts`), the same truthful pair the
terminal's copy uses. Over plain http on the tailnet the only lane is the legacy
`execCommand`, which can say yes and copy nothing, so a legacy copy shows
`copyReport`'s sentence and the path in a read-only field, selected on focus, for
Android's own long-press Copy. A refused copy says "not copied" and shows the same
field. The button lights "copied" only for a confirmed clipboard copy.

**A file opened from a browse comes back to its folder**, because a tab that
drops its place makes the operator start again. A tapped file opens as a tab and
the browser closes, but the browse (root, project, floor and the level the file
was tapped on) rides the file's pane as `from`. `‹ folder` on that tab re-opens
the browse at that level; the tab stays in the row, so a second file from the
same folder stacks a second tab, and each tab goes back to its own folder. The
tab's × closes it. A file opened from a card, the memory screen or the feed has
no `from`, and its `‹ back` closes the tab. `FilesScreen` takes `at` (the level
to open on, never above the floor) and reports the level with every file it
opens.

**Home, project and aipass browses say the chips are off.** Git chips are keyed
by a branch, so outside a branch root the listing is plain. A quiet line under
the head says "git status is not shown here", so plain rows do not read as clean.

**Every refusal ends with its ref.** @api answers a refusal built from a caught
exception with one fixed sentence per code and a short `ref` that joins it to the
host's log line. The transport's `errorFrom` appends it (`host/errorRef.ts`):
"This read was refused; the reason is in this host's log (ref a1b2c3d4e5f6)". A
refusal without a ref (the fence's named refusals) reads plain.

**An untracked row does not open a refusal.** git's diff cannot see a file it
has never seen. In the card's GIT tile (branch grain) a U file opens in the Reader
on the git app's own stack, so `‹ back` returns to the list. A collapsed new
`dir/` answers under its row: "new directory — nothing to diff; browse it from the
files door". In the wheel's git app (repo grain) a U file answers under its row,
"new file — nothing to diff; read it from the files door": its path is relative
to the repository, and no root the phone can name is sure to be that repository's
top. A second tap closes the answer.

**A commit prints its subject once.** @api's `message` is the whole message, so
the block under the subject holds the message without its first line and the
blank line after it, and is not drawn when nothing is left. A commit with no files
of its own (a merge) says "this merge changes no files of its own" instead of an
empty "files changed" heading.

**The git sheet's no-agent line tells the two cases apart.** "the fleet read has
not landed" is for a fleet read that has not answered. When it answered and the
seated project has no agent, the sheet says "no agent in this project to read
the repository through".

**No remote is an answer (contract C-D).** When @api answers the remote read with
`remote: null`, the sheet shows "no remote configured — no links" where the links
go. A refusal (an unreadable repository) shows its sentence there, with its ref.

### Back goes back to where it came from

**The rule.** `‹` and the phone's own Back return to exactly the screen, folder
or card you came from, one level at a time. Only the close glyph closes outright,
and opening anything never discards what it was opened from.

**The trail.** `lib/trail.ts` holds the screens left through a door, newest last.
Every card door that opens a screen (README, inbox, plans, todos, memory, files,
claude-settings, passport) leaves the card on it, so that screen's `‹ card`
reopens the card. A roots pick leaves the roster (`‹ roster`), and the passport's
records door leaves the passport (`‹ passport`). The doors to a pane (attach,
resume, fresh, shell, `?`, watch, the monitors) close the card, because the
operator is going to the stage. The git tile's `‹ card` works the same way.

**Files.** A file opened from a browse is a tab, and its pane keeps the browse
(`from`) and the trail under it (`fromTrail`). `‹ folder` puts both back, so the
browse's floor `‹` still reaches the roster, passport or card it came from.

**Labels and the close glyph.** Every `‹` names where it lands: `‹ wheel`,
`‹ card`, `‹ roster`, `‹ folder`, `‹ passport`, `‹ feed`, `‹ inbox`,
`‹ settings`. The roster, machine sheet, feed and settings home say `‹ wheel`.
The face has one close glyph, the tab's `×`. The passport and settings use it,
and the desktop's two shared panels take it as a prop, so the desk keeps `✕`.
The close glyph closes the whole panel everywhere: the interface section's `×`
and click-away close settings, while Escape and `‹ settings` go back one level.
The passport's `×` and the agent settings' `×` close the panel and land on the
card that opened them. The feed's back is the read.

**Android Back.** `lib/systemBack.ts`: each open screen registers the handler its
`‹` calls (the files browse, inbox, git app and settings register inside
themselves, so Back climbs their own levels). While anything is open, history holds
one guard entry; Back runs the newest screen's handler and puts the entry back if
something is still open. A close by tap takes the entry off again. On the wheel
with nothing open there is no entry and Back is the browser's; the PWA may leave.

**Tabs survive a reload.** `lib/tabStore.ts` keeps the tab row, the front tab and
the focus history in localStorage (`baud-phone-tabs`, beside the seat). On load
they wait for the first fleet read and the roster's answer. Each agent's card is
then taken fresh from the census, and a tab whose agent has gone is dropped with one
console line. A restored room is a reattach and types no launch line. A restored
file re-reads. A reload lands on the wheel: the screen that was open and the
trail are not kept.

**Closing a tab fronts the one before it.** The focus history decides, not the
row's order. With no history left, the rightmost tab is fronted.

### A new project from the switcher

The last row of the header's project menu reads **+ new project**. Under a read
token the row is there and a tap answers under it with the verb chips' own
reason (*refused: this token is read-scoped — verbs need an operate token*).
Under operate it closes the menu and opens `NewProjectSheet.tsx` on the agent
sheet's scrim:

- a name field, with the rule under it: *letters, digits, _ and -, starting with
  a letter*. `lib/newProject.ts` holds the same rule as the host (up to 64
  characters), so an obvious typo is refused on the phone before any request;
  the host's rule still decides;
- the template chips **empty** (selected) and **python**;
- one **create** button. While the request is out it reads *creating…* and the
  sheet's controls are disabled.

`create` posts `{name, template}` to `POST /v1/verbs/new-project`
(`verb_new_project`). A refusal (bad name, bad template, a project that already
exists, a failed scaffold) shows the host's sentence verbatim and the sheet stays
open. On success the sheet closes, the phone seats itself in the new project, and
the manager's room opens the way its card's room door would: the card is built
from the host's answer (`agent`, `agent_home`, and `project`), and a
newborn card with no room and no history offers **fresh**, so the birth
conversation starts on the phone. The seat and the room use `project`, the
census name (the registry's, so `phone-probe` is seated as `PHONE-PROBE`), never
the typed `name`: the census matches project names exactly. The desktop refuses
`verb_new_project` by name; it runs `aipass new` in its own terminal.
