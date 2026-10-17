# The headless doors

The same answers without a window: `baud-cli`, the binary the host API runs.

## The headless doors — the same answers, without a window

The binary has a second entry point, and a headless twin, `baud-cli` (below).
Each headless flag prints one JSON object on stdout and exits, opening no window
and touching no tauri state:

```
baud --snapshot      [--project <name>]
baud --list-projects
baud --roster
baud --end-room      <branch> [--project <name>]
baud --capture-room  <branch> [--project <name>] [--lines <N>]
baud --send-room     <branch> [--project <name>] (--text <literal> | --key <NAME>)
```

One verb per process. Writing both is a usage error rather than a precedence
rule — a caller who asked for a read *and* a kill does not know what they asked
for, and guessing for them is how a read turns into a kill.

It exists so that **"which agents are alive" has exactly one implementation.**
The phone reaches the same fleet through a host API, and the alternative to
this flag is a second room-judgment written in Python, which would drift from
this one, and once it drifted neither answer could be trusted. One
reader rather than a separate `baud-snapshot` tool, for the same reason a step
further out: a second implementation is a second version that can silently
disagree with the GUI. `baud-cli` is a second binary but not a second reader —
the same crate, the same `run_headless`, cut from the same tag.

- **stdout** is always one `FleetSnapshot` object, whole and newline-terminated
  — the same shape the window's `fleet_snapshot` command returns. A failed read
  is still a full envelope with `error` set and `branches` empty, never partial
  output and never nothing.
- **`--project`** takes a name from BAUD's own census, which is case-sensitive
  and comes from the `<NAME>_REGISTRY.json` seal — `AIPASS`, `BAUD`. An unknown
  name is refused rather than defaulted to the anchor: quietly reading the wrong
  project is how a remote verb ends up acting on a session nobody named. With no
  `--project`, the anchor is read; the window's default is the *seated* project,
  which does not exist in a process with no seat.
- **Exit codes.** `0` a real read (`error` is null) · `1` the snapshot could not
  be produced, and stdout carries a valid envelope explaining why · `2` usage
  error, and stdout is empty. So a caller may parse stdout unconditionally and
  use the code as the cheap check. Failures also print the reason to stderr.
- **It resolves the anchor by walking up from the working directory**, exactly
  as the window does, so a caller whose CWD sits outside the tree gets exit 1
  and must either run inside it or set `AIPASS_ROOT`.

### `baud-cli` — the same doors, with no desktop

The desktop `baud` links the whole GUI stack even to print a snapshot — 129
shared objects, webkit2gtk and GTK 3 among them — so a server or a container
with no desktop cannot start it. `baud-cli` is the headless shape of the same
reader, not a Python re-reader: a second binary target in the same crate, `src-tauri/src/bin/baud_cli.rs`, which hands its
arguments to `run_headless` and exits with its code.

- **The six verbs answer exactly as above**: same arguments, same stdout, same
  exit codes. `baud` keeps answering them too. Error lines on stderr carry the
  name the process was started as, `baud:` or `baud-cli:`.
- **It never opens a window.** With no verb, or none of the six, it prints the
  six to stderr and exits `2` with stdout empty.
- **It is built with the `gui` feature off**, which is what keeps GTK out:
  `cargo build --release --locked --no-default-features --bin baud-cli`. `gui`
  is on by default, so `npm run tauri dev`, `npm run tauri build` and
  `cargo test` build what they always built; it gates tauri, the opener plugin,
  the terminal, the screenshot portal and every `#[tauri::command]` wrapper. The
  lanes only the window uses (`memory`, `notifications`, `pty`, `reads`,
  `screenshot`, `settings`) build only with it. Give `baud-cli` its own cargo
  invocation: built beside the app, feature unification switches `gui` back on.
- **It links libc, libgcc_s and the loader, and nothing else** — about 520 KB.
  CI builds it and fails if `ldd` names libgtk, libwebkit, libjavascriptcore or
  libsoup. A bare `ubuntu:24.04` container with no packages added runs it:
  `--roster` exits `0` inside a tree with `src/aipass`, and outside any tree
  exits `1` with the envelope saying so.
- **The host API prefers it.** @api resolves the binary per request, in the
  this order: its `baud_bin` setting, then
  `~/.aipass/baud/bin/baud-cli` (where `aipass baud install` lands it), then
  this checkout's `target/release/baud-cli`, then `target/release/baud`, then
  `baud-cli` and `baud` on `PATH`. That resolution is @api's code; this repo
  ships the binary.
- **Releases carry it** as `baud-cli-v<version>-linux-x86_64`, beside the
  desktop binary, with its sha256 in the same `SHA256SUMS.txt`.

### `--end-room` — the kill seam

`room_kill` is a tauri command, reachable only from inside the running desktop,
so the host API cannot proxy it. This flag is the host API's door to
`/v1/verbs/kill`, and it is a **door onto the one
mechanism, never a second one**. `--end-room` and the desktop's *end room*
button both call the same `end_room_in`, which calls the same `room_kill_named`
— there is no `tmux kill-session` anywhere in the headless path. One thing ends a
session, because a second door eventually disagrees with the first.

- **stdout** is always one `KillOutcome` object. `detail` and `error` are
  mutually exclusive by construction — exactly one is non-null, and which one
  matches the exit code, so a caller reading only one field can never be misled
  about whether it worked.
- **`ended` is not the same as success.** `ended: true` means this call ended a
  live session; `ended: false` with no error means there was nothing to end.
  Both exit `0` — killing a room that is already gone is the goal state, not a
  failure — but they are different facts and the phone shows different sentences.
- **An unknown branch is refused, not reported as nothing-to-end.** They would
  look identical in a `null` room and are opposites: one means the caller holds
  a stale or wrong name, the other means the goal is already reached.
- **Fenced on names, not paths**, like the read lane. A branch name that is not
  a single directory component is refused before anything resolves it, and the
  sentence says *why* — a refusal that reads "no such branch" invites a retry.
- **Exit codes** are the snapshot's, deliberately: `0` did what was asked · `1`
  refused, with a full envelope explaining why · `2` usage error, stdout empty.

**Exit 1 and exit 2 are not two flavours of "no".** A *structural* mistake —
a flag missing its value, two verbs in one line, no branch named — is exit 2:
whoever built the command line built it wrong, and it never ran. A *value* the
caller chose — a key name off the allowlist, a scrollback depth past the cap —
is exit 1 with a full envelope, because that sentence has to reach the
operator's screen rather than becoming "the invoker made a mistake". The host
API maps exit 2 to a 503 it owns; putting a phone's typo there would blame the
wrong party and tell the operator nothing.

```
$ baud --end-room cli
{"project":"AIPASS","branch":"cli","room":"baud-cli","ended":true,
 "detail":"ended 'baud-cli'","generated_at":"…","error":null}          # exit 0

$ baud --end-room cli
{… "room":null,"ended":false,"detail":"nothing live for 'cli' - already ended",
 "error":null}                                                         # exit 0

$ baud --end-room ../etc
{… "detail":null,"error":"branch name '../etc' is not a single directory
 component - this door takes names, not paths"}                        # exit 1
```

### `--capture-room` and `--send-room` — unused, and not the input path

**Nothing calls these.** The phone attaches a real tmux client, so keystrokes
ride a PTY. Both stay in the binary as working, tested code, and their status
is stated here so *unused-but-shipped* never quietly becomes a second door:

- **`--send-room` is NOT the phone's input path and NOT a general input door.**
  The attach PTY is the one door for input. This flag exists, works, and is
  routed to by nothing.
- **`--capture-room` earns its place on its own argument**: looking is a read,
  typing is a verb. Attach is operate-only *by nature* — a shell prompt has no
  reading half — so a capture is the only possible path to a look-don't-touch
  view under a read token.

Neither flag attaches: `capture-pane` observes, so nothing about the operator's
own view changes — no resize, no focus, no second client.

- **`--capture-room`** returns `{project, branch, room, pane, cols, rows,
  captured, detail, error, generated_at}`. `pane` keeps its escape sequences,
  because a monochrome mirror of a coloured screen is a different screen.
  `--lines` reaches N rows above the visible screen (default 0, cap 2000,
  **refused not clamped**).
- **`--send-room`** takes exactly one of `--text` or `--key`. They are different
  mechanisms, not two spellings of one: a literal is **typed** through
  `send-keys -l`, a key name is **interpreted**. A literal `C-c` in `--text`
  types those four characters; `--key C-c` presses the interrupt. Both-or-neither
  is refused, because guessing which one a caller meant is how a paste turns
  into a control code.
- **`--key` names come from a fixed allowlist** — `Enter, Escape, Tab, Up, Down,
  Left, Right, C-c, C-d, C-l, C-u, BSpace, PageUp, PageDown`. `send-keys`
  without `-l` interprets whatever it is handed, so an unbounded name would be
  an unbounded keystroke.
- **`--text` never appends a newline.** A paste alone can therefore never
  execute; running it stays a separate, deliberate act. This is BAUD's own rule,
  already written into `Terminal.tsx` for the desktop, carried onto the wire
  rather than reinvented for it: a command typed through the flag sits
  unexecuted at the prompt.
- **A room that is not live is refused**, not returned as an empty screen. One
  is a fact about the fleet; the other looks exactly like a dead agent.
