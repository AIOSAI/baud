# The wheel and the header

This page covers the fleet rail (the wheel), the header: the name that reloads the face, the lock chip and the verbs, the `GIT` tile, how the wheel keeps names whole, and the project switcher's new-project sheet. The expanded agent card and the passport are on [the card page](card.md).

← [the phone face](../phone.md)

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

### The header name is the refresh

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

### The verbs and the lock chip

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
[`--end-room`](../headless.md#--end-room--the-kill-seam). The payloads are the rows in `transport.http.ts`: `wake`
sends `branch`, `project` and `message`; `kill` sends `branch` and `project`;
`lock` sends an empty body.

**Why these two guards and no others.** The token is the wall: the owner's
laptop, the owner's network, and the server dies when the laptop does. The
confirm tap and the dark-screen check stay because they protect a *thumb*, not
data: a pocket tap ending a live session is a real cost with no upside. Scope
stays because it is the server's rule, not the client's.

### The GIT tile

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
the changes screen in [the git app](files-git.md#the-git-app--the-fourth-layer-is-not-an-agent), and that screen asks the same route for the
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
