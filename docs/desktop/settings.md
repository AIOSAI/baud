# Settings

This page covers the desktop's settings: the card gear that edits one agent's claude settings, the header gear for BAUD's own interface, the memory dials over @memory's config, and the host API tab for the relay.

← [the desktop window](../desktop.md)

## Settings

Two gears, three files, one doctrine: **BAUD is an editor of operator-owned
config, never its owner.**

### The card gear — one agent's claude settings

Writes `<branch>/.claude/settings.local.json`, claude's own file. Operators keep
permission blocks, MCP server lists, hooks and env in there, so the write is
surgical: the existing document is parsed, exactly three keys are touched, and
every other key is handed back untouched.

| Panel row | Key on disk |
| --- | --- |
| model | `model` |
| auto-compact | `autoCompactEnabled` |
| threshold | `autoCompactWindow` |

The patch is three-state, so "leave it alone" and "unset it" can never be
confused: a field absent from the patch is not touched, a field explicitly
`null` REMOVES the key, a field with a value sets it. Choosing **Inherit** is
the null case on all three dials — the key is deleted, not blanked. The panel
sends a field only when the operator's value differs from **what the file
says**, and an absent key reads as absent, never as the value claude would have
picked.

That last clause is load-bearing. A dial that baselined an absent key against
a guessed default would open a file carrying only `model` showing *on, 350k*,
match what the operator wanted, produce no difference to send, and leave
**save** disabled: readable, never stampable. The guess would also be untrue:
claude's real threshold follows the model, so an opus-1m seat reading "350k"
compacts near 1M, which is to say never.

Failure mode is refusal. A settings file that exists but does not parse as a
JSON object errors out and nothing is written — losing a deny-rule to a settings
toggle is the worst bug this file could ship, and overwriting what we cannot
read is never the safer choice.

`read_object` splits by error kind: `NotFound` reads blank (a fresh branch is
not a fault), and **every other read error refuses** — a permission bit, a mount
that went away, a directory in the file's place. Reading those as `{}` would be
silent all the way down: the gear reads blank, every dial renders at *unset*,
and the next save writes a fresh three-key document over an operator's
permission rules with nothing anywhere to report. Two tests hold
it: an unreadable file must not read as `{}`, and a patch over one leaves the
file byte-for-byte as it was.

One divergence from @api's python mirror of this reader is deliberate: python also reads *not-a-directory* as blank, and
`io::ErrorKind::NotADirectory` needs Rust 1.83 where this crate's MSRV is
1.77.2. That case refuses here instead, which is the safe direction to be wrong
in, and it is on the conformance list rather than hidden. Writes land through a temp file in the same
directory and a rename, so a reader never sees a half-file. Keys come out in
file order (serde_json is built with `preserve_order`), so a one-key change
does not reshuffle a document somebody else wrote.

Model strings pass through opaque — which model ids exist is claude's business
and it changes without us. A model the file already carries that the panel does
not list stays listed verbatim rather than rendering as Inherit. BAUD never
passes a model on the command line — it writes the key in claude's own settings
file, and claude reads that file when a session starts in the branch, so the
choice is not tied to BAUD's launch button.

**auto-compact** is a three-position select — Inherit, On, Off — because a
switch has two positions and this dial has three. The **threshold** slider runs
100k–1M in 50k steps and reads `not set` while the key is absent; it starts at
350k purely as a slider position, a claim about nothing. Choosing **On** stamps
that threshold too, disclosed as a second pending change: `autoCompactEnabled`
alone would leave the cutoff at claude's model-dependent default, which is the
exact trap above. **Inherit** hands both keys back. **Off** leaves a stored
threshold in place — that is what the file says, and the panel does not edit what
it was not asked to.

**The memory row** is the only row in this gear that does
not touch claude's settings file — which is why it commits on its own, on blur,
instead of riding the panel's save button. One button writing both would make a
model change quietly rewrite this agent's memory. It lists the keep-counts, how
many entries of each type survive a rollover, and each dial goes through
`drone @memory config set <branch>` — the same verb a human would type — then
re-reads the file, because @memory's refusals exit zero and only the read-back
proves a number moved.

Each dial says which number it is showing: **override · fleet default 20**, or
just **default**, so nobody edits a shared number thinking it is theirs or the
reverse. The timing is stated on the row — *applies at the next rollover run* —
and one edge is written into the code rather than hidden: @memory resolves
per file KEY, so a branch carrying a *partial* group block could be shown a
default here that the engine would not apply. No branch carries such a block,
and the correct read is a resolved one from @memory rather than BAUD
re-deriving the rule.

### The header gear — BAUD's own interface

Writes `<project root>/.aipass/baud.settings.json`, per seated project. The
backend treats the document as opaque: a shallow top-level merge, `null` removes
a key, and it hands the whole document back as written.

| Row | Key | Default when absent |
| --- | --- | --- |
| startup agent | `startup_agent` | none — BAUD opens nothing |
| poll every | `poll_interval_ms` | 5000 (menu: 2s/5s/10s/30s, accepted range 1s–300s) |
| bell keeps | `bell_max_events` | 200 (menu: 50/100/200, accepted range 1–500) |
| bell chime | `bell_sound` | off |

Absence and nonsense both fall back to the default — the file is
operator-editable by hand, and the app must keep running rather than poll every
0 ms. A stored value the menu does not offer stays listed instead of being
silently rewritten.

**Startup agent** fires once per app run, as soon as the first snapshot and the
settings have both landed, and only if the operator has not already picked a
card. It goes through the same `launch` door a card click uses, with the card's
own judgment: a live session attaches, a branch with history resumes, anything
else starts fresh. A named agent with no card in the seated project is a console
warning, not a fault banner.

Two things hold it back, so it cannot resurrect an ended room. BAUD is
developed in the window it is used in, so every frontend save hot-reloads the
app, and a guard held in a React ref would be re-armed by every remount; the
guard lives in `sessionStorage` instead — one shot per app RUN, not per mount.
And the startup agent refuses outright to open a branch whose room the operator
ended. `app/src/intent.ts` holds both
marks and nothing else; it is the only place in the frontend where an operator
decision is stored rather than derived.

**Hook sounds** is the one row that is not a setting of ours, and the panel says
so. AIPass hook sounds are muted by the existence of a flag file named
`aipass-hooks-muted` in the OS temp directory (@hooks' own switch: the file
exists = muted). BAUD is a second hand on that same switch — it flips on click
rather than on save, both directions are idempotent, the state is read live on
open because a shell or another window may have flipped it, and nothing about it
is mirrored into `baud.settings.json` where it would drift. The flag lives in
the temp directory, so it resets on reboot; that is the flag's design, not ours.

Under the interface rows, two more that store nothing:

- **phone · pair a phone** closes the dialog and opens a terminal tab at the
  project root already running `drone @api host-api pair phone --scope operate`,
  the help-terminal pattern: keyboard on, the command draws its own one-use QR
  (five minutes), and `exit` closes the tab. The button waits, disabled, until
  the seat's root is read.
- **about** shows `BAUD <version>`, the app's own version as Tauri reports it.

### The memory dials — @memory's config, edited from here

A **memory** section of its own — the desktop gear's second tab, and the phone's
`settings → memory` row — reads
`<AIPass root>/src/aipass/memory/memory_json/custom_config/memory.config.json`
— @memory's file, shared by every citizen in the ecosystem. It carries its own
save button, deliberately: one button writing two owners' config is how a
poll-cadence tweak ends up silently rewriting the fleet's memory limits.

**It is not part of the interface panel.** "Interface" is this face's look and
feel; these dials are another agent's fleet-wide config, and one door cannot
honestly be labelled for both. Same component on both faces, one implementation, two placements.

| Half | What it sets | Written by | When it takes effect |
| --- | --- | --- | --- |
| entry caps | `entry_limits.entry_types.<type>.max_chars` — chars per entry | BAUD, directly (no verb exists) | immediately; the enforcement hook re-reads the file on every memory write |
| keep-counts | `rollover.defaults.<group>.<container>.count` | `drone @memory config set-default` | at the next rollover run, and only for branches after a push |

**The two halves travel different lanes, and that split is the rule.** Every
keep-count goes through @memory's own verbs rather than BAUD editing the
file, so the bounds (1–100) and the refusal wording live in one place instead of
being re-implemented here and drifting the first time @memory changes them. Only
the character caps use the direct write, because @memory has no verb for
them. `auto_compact_cap` is displayed and **not** editable — it is read-only
in v1, and an input that silently does nothing is worse than no input at all.

**The panel runs the push itself**, behind a two-tap confirm, and its copy
carries @memory's real semantics unsoftened: changing a default does *not* reach
any agent, and until you push, every agent carrying an override keeps reporting
its old number. When no branch overrides exist the panel says so in a sentence —
*every agent is at the defaults* — rather than showing an empty region, which
reads as a list that failed to load. **Per-agent limits are editable from the
card gear**, each dial committing on blur through the same verb.

Nothing promises a schedule, because there is none: there is no daemon tick, and
a changed limit is applied by the next rollover *run* — a compaction hook, a
watch, or somebody running it by hand. Nothing is hardcoded either: the caps, the
dials and the branch list are whatever the file says today, and an entry type
@memory adds simply appears.

**A refused write exits zero.** `drone @memory config set` prints its refusal and
returns success, so nothing in this lane trusts an exit code: the wrapper looks
for @memory's own marker, passes their sentence through unreworded, and re-reads
the file afterwards — the read-back is the proof a number moved, never a string
BAUD parsed. The phone meets the same hazard in a different costume, where @api
forwards an after-routing refusal as HTTP 200 with `ok: false`, and its transport
throws on that. (Pre-routing validation failures *do* arrive as a 400.)

Two refusals guard the direct lane, both stricter than the card gear's. A dial
that does not already exist on disk is **not created** — BAUD turns dials it can
see, and inventing structure in another agent's config is the cross-edit the
ecosystem forbids. And zero is refused: it is the one value that reads as a
valid number and silently breaks every memory write in the fleet. Both refusals
happen before a byte is written. The keep-counts inherit the equivalent refusal
from @memory itself because they travel the verb: one owner, one bound, one
sentence.

One honest cost, measured on a copy of the real 8 KB file rather than guessed:
moving one dial rewrites 2 of its 364 lines. One is the number. The other is
@memory's own `_note`, whose em-dash was `—` on disk and comes back as
literal UTF-8 — the same decoded string, spelled differently. Both writers
build serde_json with `preserve_order`, which is what keeps the rest of the file
in place.

### The host API tab — where the relay reaches the server

The gear's third tab writes this machine's `host_relay.json` in the app's config
dir (`~/.config/ai.aipass.baud/` on Linux), never a project's file: the address
belongs to the machine, not to the seat. A blank row clears its key on save.

| Row | Key | Blank means |
| --- | --- | --- |
| address | `url` — `http://host:port`, nothing more (no https: the relay is built without TLS) | ask `drone @api host-api config` on this machine |
| token receipt | `token_path` — absolute path to a receipt file | this machine's `baud-desktop` receipt, minted on the first call |

A desktop on the machine that serves the host API leaves both blank. A desktop
on a second machine types the server's tailnet address and the path of a
receipt issued on the server (`drone @api host-api issue-token <label> --scope
operate`) and copied over. The relay never mints a typed path. A save refuses a
malformed address or a relative path and leaves the file as it was; it takes
effect on the next relay call.
