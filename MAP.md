# BAUD — Map

<!-- Breadcrumbs, not documentation: what exists and where to look. Depth lives
     in README.md (the app's source of truth) and in the files themselves, which
     carry their reasoning in their own doc comments. If a line here disagrees
     with the tree, the tree is right and this file is stale — fix it. -->

**One app, two faces, one seam between them and the machine.** The *desktop* is
a Tauri window that talks to a Rust backend in the same process. The *phone* is
the same React app built against an HTTP transport instead, served over the
tailnet by @api's host. Neither face knows which one it is: they both call the
same typed verbs, and a single alias in a vite config decides what those verbs
turn into.

Everything below is under `app/` unless it says otherwise.

---

## Start here — the five files that explain the shape

| File | What it is |
|---|---|
| `src/host/index.ts` | **The vocabulary.** Every verb either face can ask for, typed, in one list. 41 of them. |
| `src/host/transport.ts` | The desktop's answer: `invoke` into Rust. |
| `src/host/transport.http.ts` | The phone's answer: `fetch` to `/v1/*`, plus the WebSocket. |
| `vite.config.phone.ts` | **The whole port**, one alias: `./transport` → `transport.http.ts`. |
| `src/types.ts` | The shapes both faces read — hand-mirrored from Rust. See *The type seam*. |

---

## Entry points

| Where | What starts |
|---|---|
| `index.html` → `src/desktop/main.tsx` → `src/desktop/App.tsx` | The desktop window. |
| `phone.html` → `src/phone/main.tsx` → `src/phone/PhoneApp.tsx` | The phone face. |
| `src-tauri/src/main.rs` → `lib.rs::run()` | The Rust side; also `baud --snapshot`, the CLI the fleet read execs. |
| `../src/baud/baud/apps/baud.py` | The AIPass branch shim (`drone @baud`). Nothing to do with the app. |

---

## The desktop face — `src/desktop/` (19 files)

One window, panes inside it. `main.tsx` mounts, and `App.tsx` (929 lines) is the
shell that owns the rest. The other 17 files are the panes themselves — they are
desktop-only, and since 2026-08-18 the directory says so.

| File | One line |
|---|---|
| `Terminal.tsx` | The operator's real terminal — xterm over a Rust pty. The centrepiece. |
| `FleetStrip.tsx` | The fleet, as a strip of cards. |
| `BranchChip.tsx` | One agent's card: status, counts, doors. |
| `FileTree.tsx` · `FileView.tsx` · `DiffView.tsx` | Browse, read, diff. |
| `PassportView.tsx` | An agent's identity and memory, read. |
| `MonitorPane.tsx` · `InquiryPane.tsx` | Log monitor; the ask-an-agent pane. |
| `Bell.tsx` | The notification shade and its unread marker. |
| `SettingsDialog.tsx` · `AgentSettings.tsx` · `InterfaceSettings.tsx` · `MemorySettings.tsx` | Four settings surfaces: one per owner of the file being edited. |
| `ProjectSwitch.tsx` · `Camera.tsx` · `Zoom.tsx` | Seat picker; capture; scale. |

## The phone face — `src/phone/` (33 files on three shelves)

One column, one screen at a time. `PhoneApp.tsx` (1502 lines) is the shell:
panes, seat, doors. Screens stay on top; the repository sub-app is in
`phone/git/` and the no-JSX logic in `phone/lib/`. **The pollers are no longer
in the shell** — all four moved to `lib/pollers.ts` on 2026-08-18, which is what
took 330 lines out of the file above.

**Screens and sheets**

| File | One line |
|---|---|
| `FleetWheel.tsx` | The wheel — the fleet as one flick. The face's standing screen. |
| `AgentSheet.tsx` | One agent's card, opened. |
| `TerminalSheet.tsx` | The room, over a WebSocket. The other big one (2983 lines). Owns the composer's delivery rule (a line goes out as a declared bracketed paste; the `\r` waits until the room has SHOWN it), the keyboard rule (no tap opens one into the terminal), and TYPING MODE - **one compose slot with two modes**: the baud box, or the armed bar that hands raw keys to xterm's own textarea. The mirror-diff lane is dead (r6) and the bar's own row is gone (r8) - both live in the same footprint now. The room SLIDES under the keyboard rather than being resized, for either mode. Re-states its grid to the pty on every return to the foreground, so a pty moved from the host side is corrected the moment he looks instead of leaving the phone clipping a window it does not fit. The chip row's one-pixel field is still the only soft-keyboard door for `ctrl`/`alt`; typing mode does not touch it. |
| `Reader.tsx` | Any file or diff, read. |
| `FilesScreen.tsx` · `RootsScreen.tsx` | Browse a root; pick which root to stand on. |
| `FeedScreen.tsx` | The feed, full height. |
| `MemoryScreen.tsx` · `PassportSheet.tsx` · `Certificate.tsx` | Memory; identity; @spawn's birth certificate as a document. |
| `PhoneSettings.tsx` | The phone's own settings. |
| `MonitorSheet.tsx` | Logs. |
| `MachineSheet.tsx` | What a monitor card opens to: the machine's live vitals, and the skill's own sentence for anything this host cannot read. |
| `TokenDoor.tsx` | The paste-a-token screen. Nothing renders until it passes. |
| `VerbChips.tsx` | The operate-scope buttons and their refusals. |

**The git app — `src/phone/git/`** — a sub-app with its own screens:
`GitApp.tsx` (the door) → `GitChangesScreen.tsx`, `GitCommitsScreen.tsx`,
`GitCommitScreen.tsx`, `GitDiffScreen.tsx`, with `GitFileRow.tsx` as the shared
row.

**Logic modules — `src/phone/lib/`, no JSX** — the pieces screens share:

| File | One line |
|---|---|
| `verbs.ts` | What each scope may do, and the sentence when it may not. |
| `rooms.ts` | Which door a card's state means; the room's own vocabulary. |
| `gitStatus.ts` | git's two-column code → the chip letter. One mapping, both screens. |
| `feed.ts` | The feed window size, retention, and the merge rule the badge and the screen share. |
| `whileVisible.ts` | The polling gate: no lane on this face ticks while the screen is away. |
| `machine.ts` | The monitor row's lane: `GET /v1/machine`, read only while that row is the visible wheel, and the ONE derivation of what each card face and the sheet draw from it. Not in `pollers.ts` because it is gated on a layer, not on the shell. |
| `lock.ts` | The header lock chip's lane: `GET /v1/lock` every 5 s while the app is looked at, re-read at once and 1 s after a tap, forgotten when the app goes away - and which of four faces (unread, unlocked, locked, unknown) a reading means. |
| `pollers.ts` | **All four polling lanes**, as hooks: the fleet read, the per-branch change sweep, the bell's badge, the repository count. Each owns state nothing else writes — which is why they could leave the shell at all. |
| `copyPath.ts` | floor + relative → a machine path, and the two clipboard lanes. |
| `push.ts` | The push hook, inert until phase 7. |
| `lock.test.ts` · `machine.test.ts` · `copyPath.test.ts` | vitest pins of what those modules promise - pure functions only, no DOM, no network. `npm test` runs them. |

---

## The seam — how a face asks for anything

```
a screen  →  host/index.ts (typed verb)  →  ./transport  →  invoke  (desktop)
                                                         →  fetch   (phone, via the vite alias)
```

- `src/host/index.ts` — **41 exported verbs**. Optional arguments use the
  *omitted-key* pattern: a key that is empty is left off the payload entirely,
  so the desktop's `invoke` object stays byte-identical.
- `src/host/transport.http.ts` — a **30-row route table** over **23 distinct
  `/v1` paths**, each row a `path`, an optional `query`/`body`, and an `unwrap`
  that renames the wire's fields to the seam's. Also `HostError`, the token
  store, the room socket and the image upload.
- **Two refusal tables, and they are the map of what each face cannot do:**
  - `NOT_YET` in `transport.http.ts` (12 rows) — verbs the desktop has and the
    phone does not.
  - `NOT_ON_THIS_FACE` in `transport.ts` (7 rows) — verbs the phone has and the
    desktop does not.
  - A verb with no route is refused **by name with a reason**, never bound to
    the nearest plausible path.

## The type seam — TypeScript mirrors Rust BY HAND

**`src/types.ts` (489 lines) is written by hand to match the Rust structs.
Nothing generates it and nothing checks it.** Change a `#[derive(Serialize)]`
struct in `src-tauri/src/` and you must change `types.ts` in the same sitting —
the compiler will not tell you.

- Each mirrored interface says which struct it mirrors, in its doc comment:
  `/** Mirrors \`FileText\` in src-tauri/src/lib.rs. */`. That comment is the
  index — grep `Mirrors \`` to list every mirrored pair.
- Some interfaces mirror **nothing**: they are the phone's own shapes, answered
  by @api rather than by Rust (`RootEntry`, `GitChangeRows`, `FeedWindow`,
  `GitChangeCount`). Their docs say so, and say why.
- Optional fields marked *phone-only* exist because one face's backend sends a
  key the other's does not (`floor` on `DirWindow`/`FileText`).
- **Backlog, not built:** `tauri-specta` would generate this file from the Rust
  types and delete the hand-mirroring rule. Named here so the seam is findable
  the day someone folds it in.

---

## Rust — the desktop's backend, `src-tauri/src/` (6,644 lines)

| File | One line |
|---|---|
| `lib.rs` (1768) | The root: shared constants, `BranchStatus` and `FleetSnapshot`, `run()`, and the **command registry** (`generate_handler![...]`, 29 commands) — the canonical inventory of what a face can invoke. About 430 lines of it are code; the rest is the crate's test suite, which stayed here when the lanes left. |
| `cli.rs` (628) | `baud --snapshot` and the rest of the headless surface. Every outcome serializes in full even when it failed, and the exit code agrees with the payload. |
| `rooms.rs` (515) | tmux sessions: the name sanitizer, the pane scan, kill, capture, and the send door that types but cannot submit. |
| `sessions.rs` (397) | Who is actually awake — `/proc` for the processes, transcripts for what they are doing, and the subagent count. |
| `fleet.rs` (299) | One pass over the branch directories, one snapshot out. Every fallible read degrades to a default for that card and never fails the poll. |
| `reads.rs` (282) | The read surface: directories, file text, git changes and diffs — all behind `fenced_path_in` against the seated root. |
| `projects.rs` (239) | The census and the seat: registry seals, discovery, `ActiveProject`. |
| `pty.rs` (797) | Terminals and monitors: spawn, write, resize, kill, the shutdown hook that detaches tmux rather than killing it, and the frame coalescer that gathers pty reads into one message per 60Hz frame. |
| `settings.rs` (762) | Reads and surgical writes of other owners' config files. Refuses rather than guesses. |
| `memory.rs` (728) | @memory's rollover config, edited from here. |
| `notifications.rs` (155) | Reads the feed file off disk. |
| `screenshot.rs` (148) | The compositor capture. Desktop-only by nature. |
| `main.rs` (6) | Calls `lib.rs::run()`. |

The six lanes above were split out of `lib.rs` on 2026-08-18 and are **glob-imported
straight back into it** (`use rooms::*;` and friends). That is deliberate: every call
site, and the whole test suite, names these items exactly as it did when they all
lived in one file. If you cannot find a function, `grep` the directory rather than
the file — the name did not change, only its address.

Also: `Cargo.toml` (MSRV 1.77.2), `tauri.conf.json` (window, CSP, bundle off by
design — no installers, deliberately), `capabilities/` (what the webview is
allowed to call), `build.rs`, and two directories nobody edits: `gen/` (tauri's
own) and `target/` (cargo's).

## Host lanes — the phone's backend, and it is **not in this repo**

The phone talks to @api's host server, which lives in the AIPass repo at
`src/aipass/api/apps/handlers/host/`:

| File there | Serves |
|---|---|
| `server.py` | The routes and the uvicorn app. |
| `fleet.py` · `reads.py` · `git_reads.py` | `/v1/fleet`, `/v1/rooms`, `/v1/dir`, `/v1/files`, `/v1/git-changes`, `/v1/diff`. |
| `feed.py` · `verbs.py` · `attach.py` | `/v1/feed`, the operate verbs, the room WebSocket. |
| `tokens.py` · `config.py` · `settings.py` · `memory_config.py` · `uploads.py` | Auth, config, the settings lanes, image upload. |
| `face.py` | **Serves this repo's `app/dist-phone/` off disk**, per request. |

Changes there are @api's, not BAUD's. Cross-repo findings get mailed, not fixed.

---

## Look and feel

| File | One line |
|---|---|
| `src/tokens/tokens.json` → `tokens.generated.css` | **The palette, as data.** `npm run tokens` regenerates the CSS; never hand-edit the generated file. |
| `src/theme.css` (2092) | The desktop's stylesheet, and the **shared** floor — the phone loads it too. Written entirely in `var(--baud-*)`. |
| `src/phone/phone.css` (3699) | Phone-only additions on top of `theme.css`. |
| `app/public/` | PWA icons and `manifest.webmanifest`. |

Load order is fixed and both `main.tsx` files state it: tokens → theme → phone.
**No inline styles anywhere — the CSP forbids them.**

## Shared floor — `src/*.ts`, read by both faces

`types.ts` (the shapes) · `age.ts` (relative time) · `intent.ts` (what the
operator meant) · `deliver.ts` (sending into a room) · `deliver.test.ts` (its quoting rule, pinned) · `host/` · `tokens/` ·
`vite-env.d.ts` (vite's own type shim, boilerplate).
A file at `src/` root is one both faces use; anything face-specific lives in
`desktop/` or `phone/`. The rule holds with no exceptions as of 2026-08-18 —
`App.tsx` and `main.tsx` were the two, and they now sit with their own face.

---

## Build and deploy

| Command | What it does |
|---|---|
| `npm run tauri dev` | Desktop dev: vite on **1420** (strict) plus a debug binary. |
| `npm run dev:phone` | Phone dev: vite on **1421**, with the transport alias applied. |
| `npm run build` | Desktop bundle → `app/dist/`. |
| `npm run build:phone` | Phone bundle → `app/dist-phone/`. |
| `npm test` | vitest over `src/**/*.test.ts` - the pure derivations. |
| `npm run tauri build` | → `src-tauri/target/release/baud`. **The rebuild is the deploy** — the launcher execs that path, and `/v1/fleet` execs it as `baud --snapshot`. |
| — | **The phone rebuild is also the deploy**: @api's `face.py` serves `dist-phone/` from disk per request. No restart. |

**The audit lane, before claiming green:** `npx tsc --noEmit` · `npm test` ·
`cargo test --locked` · `cargo clippy --locked --all-targets -- -D warnings` ·
both builds. CI runs the same in `.github/workflows/ci.yml` — type-check,
frontend tests, desktop build, phone build, cargo test, clippy; `build:phone` and
`npm test` joined on 2026-09-13 (DPLAN-0343). `release.yml` cuts releases.

## Identity, memory, plans — the AIPass side of the repo

| Where | What |
|---|---|
| `src/baud/baud/.trinity/` | Passport, session log, learnings, observations. Overflow rolls to @memory. |
| `src/baud/baud/.aipass/` | The branch prompt injected every turn. |
| `src/baud/baud/apps/` | The `drone @baud` CLI shim. |
| `src/baud/baud/FPLAN-*.md` | Open plans. Closed ones are listed in `CLOSED_PLANS.local.json`. |
| `README.md` (root, 2400 lines) | **The app's source of truth.** Every behaviour change lands here in the same sitting. |
| `CHANGELOG.md` | Keep a Changelog shape: what each release changed, and the Unreleased lines waiting for the next. Every row that lands adds its line. |
| `SECURITY.md` | The security model (your machine, your tailnet, per-device tokens, what a token reaches) and how to report. Dated; it moves after the scheduled security session. |
| `docs/design/` | Approved design artefacts (the wheel mockup). |
| `docs/phone_input_AS_BUILT_2d744ac.md` | The phone's input system captured at one commit: viewport contract, the intent-reading typing lane, autocorrect, liveness, the one slot, the ended-room rule, known issues. Settings and line anchors, so the state can be rebuilt from the doc. |
| `AGENTS.md` · `CLAUDE.md` | The startup protocol for agents working in this repo. |
| `BAUD_REGISTRY.json` | Machine-managed. Do not hand-edit. |
| `MAP.md` (root) | This file. |
| `app/README.md` | A pointer at the root README and this map. Nothing else lives there. |
| `tests/` (root) | No tests. Its README names where they actually are: `src-tauri/` for Rust, `*.test.ts` beside their modules under `app/src/` for the frontend. |

---

## The mess list — one entry left, 2026-08-18

Patrick's cadence was *map first, moves second*, and the moves are done. Items 1
to 5 landed in FPLAN-0444 and items 6 and 7 in FPLAN-0445, both on 2026-08-18:
`app/README.md` reduced to a pointer, `src/components/` renamed to `src/desktop/`,
`App.tsx` and `main.tsx` moved in with it, `phone/` folded onto three shelves,
`tests/` made to say where the tests actually are, PhoneApp's four pollers lifted
into `lib/pollers.ts`, and `lib.rs` split into six lanes. Each is deleted rather
than ticked, on this list's own instruction: the map should describe the tree, not
argue with it. What the tree looks like now is everything above this line.

What is left is one entry, and it is a decision rather than a task. Its number is
the original ranking, kept so that a plan naming *item 8* still names this thing.

8. **`phone.css` is 3699 lines in one file.** Findable today because every rule
   is commented and the class prefixes are systematic.
   → Leave it. Listed so nobody re-discovers it as a problem: the map is the
   fix, splitting it would break the cascade order that several rules depend on.
