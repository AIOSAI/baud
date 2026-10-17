# The phone face

The phone face: what each screen does and why.

## The phone face — a wheel of agents, read by default

`npm run build:phone` emits `dist-phone/`: BAUD as a wheel of agents, installable
to a phone home screen, built from **the same React components** as the desktop.
See [the wheel](phone/wheel.md).

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
in [files and git](phone/files-git.md#the-files-app--the-fence-learns-more-than-one-kind-of-word).

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

The served-bytes check this repo runs proves *tree matches serve*, which is not
the same claim as *git matches serve*: a build from an uncommitted tree is served
as faithfully as a committed one, and `emptyOutDir` wipes `dist-phone` on every
build, so a served bundle cannot be recovered afterwards. The bundle carries a
`baud-tree <stamp>` string naming the tree it was built from (the short `HEAD`
and either `clean` or a count of dirty paths), so one `curl` of the served bundle
answers which tree it is.

**The PWA manifest and the sign-in door describe both scopes.** `read-only` is a
property of the **token**, not of the face, and the sign-in door is shown before
either token is known, so both say what is true of both scopes; the header's lock
chip says which one arrived.

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

## The pages

Each screen of the face has its own page under `docs/phone/`.

| Page | What it covers |
| --- | --- |
| [wheel](phone/wheel.md) | the fleet rail, the header name and reload, the verbs and lock chip, the `GIT` tile, the new-project sheet |
| [card](phone/card.md) | the expanded agent card, cross-project doors, pane keys, the passport, the manager monitors, the birth certificate |
| [room](phone/room.md) | the terminal sheet: attach, geometry, the key bar, scrolling, the standing layout, zoom, fullscreen, stream cost |
| [room input](phone/room-input.md) | typing into a room: Enter and bracketed paste, the compose slot, armed typing, the keyboard rule |
| [room delivery](phone/room-delivery.md) | links and copy, sending a photo, dropped writes, a dead room and its reconnect ladder |
| [files and git](phone/files-git.md) | the git app and the FILES app: roots, browsing, copying a path, git status on rows |
| [backup](phone/backup.md) | the backup app: the store, the four presses, stop and progress |
| [monitor](phone/monitor.md) | the monitor row, the cpu page, what is running, rooms and watches that end |
| [settings and navigation](phone/settings-nav.md) | the bell and the feed, the gear, the startup seat, designed reads, settings, Back and tabs |
