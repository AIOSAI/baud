# The FILES app and the git app

This page covers the two apps on the wheel's apps layer that read the disk: the git app (changes, commits, patches, remote links) and the FILES app (roots, browsing, copying a path, git status on rows, returning to a folder).

← [the phone face](../phone.md)

### The git app — the fourth layer is not an agent

Every other door on this face is addressed to somebody — a card, a room, a
passport, a memory — and **the repository they all live in belongs to nobody**,
so it has nowhere to hang on a rail made of citizens. The wheel has a fourth
layer for surfaces that belong to the project rather than to anyone in it:
`current project`, `live`, `dispatched`, **`apps`**.

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

The apps layer's `FILES` card sits beside `GIT`, second entry in
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

**A long level pages, it never errors.** `/v1/dir` answers one page (400
entries) with `truncated` true while more remain. A host that also answers
`total` is asked for the next page with `offset`, the count of entries already
held: a quiet line reads *400 of 1059 shown* and a `show more (659 left)` row
closes the list. Pages append by path, so a file is never listed twice, and a
page that brings nothing new ends the paging. A host without `total` cannot
page, so the line says *the first 400 shown - this host does not list further*
and no button is drawn. Deleted-file rows wait for the whole level, since a
missing name may sit in a page not yet asked for.

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

### Git rides the row it belongs to

The files screen paints status onto the listing it already has:
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
files door". At repo grain the paths are relative to the repository, and
`/v1/git-changes` names the files root that repository is: `aipass` for the
server's own repo, `project` with the census name for a project's. Through it a
U file opens in the Reader and a U `dir/` opens the files door at that folder,
both addressed `<name or kind>/<path>` with `root` and no `project`. A nested
tree no root holds answers `root: null`, and its rows keep the words ("new file —
nothing to diff; read it from the files door"). A second tap closes an answer.

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
