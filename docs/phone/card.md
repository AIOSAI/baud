# The agent card and the passport

This page covers the expanded agent card: its doors, what crosses projects, the one terminal seat and its pane keys, the avatars' marks, the passport, the manager monitors and the birth certificate. The rail itself is on [the wheel page](wheel.md).

← [the phone face](../phone.md)

### The expanded card

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
| `settings` | fenced | the sheet's memory dials name a branch and **no** project |

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
later, somewhere else, as damage. The settings route itself takes `project`
(the read on the query, the write in the body), so the claude settings resolve
to the card's own agent; the sheet's memory dials do not, and the gear stays
shut on a foreign card while they name no project.

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
