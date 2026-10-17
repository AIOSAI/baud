# The room: links, photos, and a room that drops

This page covers what leaves and enters a room besides keystrokes: links and copy out of a room, sending a photo, what happens to a write when the socket has gone, and how a dead room says so and comes back. The terminal sheet itself is on [the room page](room.md).

← [the phone face](../phone.md)

### Links and copy out of a room

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

### Sending a photo

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
