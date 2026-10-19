# Settings, the feed, and navigation

This page covers the bell and the feed, the settings gear, the startup seat, the designed reads behind the card's tiles, the settings panels, and how Back and the tabs move between screens.

← [the phone face](../phone.md)

### The bell

**And the bell counts while that screen is shut**, which is the only stretch a
badge is for. The feed screen polls its own cursor lane, but it mounts on open
and unmounts on close, so the count lives a level up, on the desktop `Bell`'s
model: poll the feed (on the cursor — see [Nothing polls a pocket](../phone.md#nothing-polls-a-pocket)), hold
a marker for how far the operator has read, badge the difference, key the marker
per project because another project's feed is another history. It diverges from
the desk in one deliberate place. The desktop's shade is a glance with a `CLEAR`
button beside it; the phone's feed is a full-height screen you must leave to get
back to anything, so **leaving is the read** — the marker moves on close, never
on open, so nothing can be marked read while it is still arriving behind the
screen you are looking at.

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
is the wrong store for whole letters. @ai_mail stamps three strings into a
`kind: "mail"` event beside its preview: `mail_id`, the message's `id` in the
recipient's inbox; `recipient`, the branch whose inbox holds it, without `@` (a
stray one is stripped); and `project`, the project that branch belongs to. A row
carrying `mail_id` and `recipient` opens that message in the recipient's inbox
screen; back lands on the feed. With `project`, that project's
inbox is read directly; an event without it finds the recipient in the seated
census first, then the roster. A message the inbox no longer holds says so in one
line. Rows without the keys stay plain.

**Markdown has a preview.** A `.md` file opens raw, the way it sits on disk. A
`preview` button in the Reader's header, beside `copy path`, switches the pane to
the drawn document and reads `raw` to switch back; every new file opens raw
again. The preview is the Reader's `preview` door: `marked` (18.1.1, pinned)
draws headings, lists, tables, fenced code, links, `<details>` blocks and GitHub
alerts (`> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`), then `dompurify`
(3.4.17, pinned) cleans the whole result, raw HTML in the file included. Its
allowlist keeps document tags only: no script, no event handler, no `style`, no
iframe or form. Only `http(s):` and `mailto:` addresses survive, so a relative
link or image keeps its words and loses its address; a link opens in a new tab,
a class the renderer did not write is dropped, and a checkbox cannot be ticked.
An image with an absolute `http(s)` address is drawn inline and fetched from its
host; a relative image path shows its alt text. The phone page carries no CSP, so
that allowlist is the wall. An empty file says *this file is empty*.

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
