# BAUD — Map

<!-- Breadcrumbs, not documentation: what exists and where to look. Depth lives
     in docs/ (the operator's documentation) and in the files themselves, which
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
| `src/host/errorRef.ts` | The envelope's `ref` on the end of a refusal's message, "… (ref a1b2c3d4e5f6)", so every refusal on the phone has something to grep. Pure, plus `errorRef.test.ts`, which also drives the transport's refusal path with `fetch` stubbed. |
| `vite.config.phone.ts` | **The whole port**, one alias: `./transport` → `transport.http.ts`. |
| `src/types.ts` | The shapes both faces read — hand-mirrored from Rust. See [the type seam](docs/architecture.md#the-type-seam--typescript-mirrors-rust-by-hand). |

---

## Entry points

| Where | What starts |
|---|---|
| `index.html` → `src/desktop/main.tsx` → `src/desktop/App.tsx` | The desktop window. |
| `phone.html` → `src/phone/main.tsx` → `src/phone/PhoneApp.tsx` | The phone face. |
| `src-tauri/src/main.rs` → `lib.rs::run()` | The Rust side; also `baud --snapshot`, the CLI the fleet read execs. |
| `src-tauri/src/bin/baud_cli.rs` → `lib.rs::run_headless()` | `baud-cli`: the six headless verbs with no window, built with the `gui` feature off. The binary the host API prefers. |
| `../src/baud/baud/apps/baud.py` | The AIPass branch shim (`drone @baud`). Nothing to do with the app. |

---

## The faces and the backends — a row each, the detail one link away

| Piece | Where | The detail |
|---|---|---|
| The desktop face | `src/desktop/` | [its files, on the desktop index](docs/desktop.md#the-desktop-face--srcdesktop-19-files) |
| The phone face | `src/phone/` | [its files, on their own page](docs/phone/files.md) |
| The type seam | `src/types.ts` | [TypeScript mirrors Rust by hand](docs/architecture.md#the-type-seam--typescript-mirrors-rust-by-hand) |
| The desktop's backend | `src-tauri/src/` | [the Rust files](docs/architecture.md#rust--the-desktops-backend-src-taurisrc-6644-lines) |
| The phone's backend | @api's host, not in this repo | [Host lanes](#host-lanes--the-phones-backend-and-it-is-not-in-this-repo), below |

---

## The seam — how a face asks for anything

```
a screen  →  host/index.ts (typed verb)  →  ./transport  →  invoke  (desktop)
                                                         →  fetch   (phone, via the vite alias)
```

- `src/host/index.ts` — **48 exported verbs**. Optional arguments use the
  *omitted-key* pattern: a key that is empty is left off the payload entirely,
  so the desktop's `invoke` object stays byte-identical.
- `src/host/transport.http.ts` — a **38-row route table** over **31 distinct
  `/v1` paths**, each row a `path`, an optional `query`/`body`, and an `unwrap`
  that renames the wire's fields to the seam's. Also `HostError`, the token
  store, the room socket and the image upload.
- **Two refusal tables, and they are the map of what each face cannot do:**
  - `NOT_YET` in `transport.http.ts` (12 rows) — verbs the desktop has and the
    phone does not.
  - `NOT_ON_THIS_FACE` in `transport.ts` (15 rows) — verbs the phone has and the
    desktop does not.
  - A verb with no route is refused **by name with a reason**, never bound to
    the nearest plausible path.


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
operator meant) · `deliver.ts` (sending into a room) · `deliver.test.ts` (its quoting rule, pinned) ·
`memoryCopy.ts` (the memory panel's words that depend on what the face could read: caps line, enforcement warning, push count) · `memoryCopy.test.ts` · `host/` · `tokens/` ·
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
| `cargo build --release --locked --no-default-features --bin baud-cli` | → `src-tauri/target/release/baud-cli`, the headless binary. Its own invocation: beside the app, feature unification turns `gui` back on. |
| — | **The phone rebuild is also the deploy**: @api's `face.py` serves `dist-phone/` from disk per request. No restart. |

**The audit lane, before claiming green:** `npx tsc --noEmit` · `npm test` ·
`cargo test --locked` · `cargo clippy --locked --all-targets -- -D warnings` ·
both builds. CI runs the same in `.github/workflows/ci.yml` — type-check,
frontend tests, desktop build, phone build, cargo test, clippy; `build:phone` and
`npm test` run in it too. The `rust` job also builds `baud-cli`
headless and checks its `ldd`; after touching the `gui` gate, run
`cargo test` and clippy with `--no-default-features` too. `release.yml` cuts releases.

## Identity, memory, plans — the AIPass side of the repo

| Where | What |
|---|---|
| `src/baud/baud/.trinity/` | Passport, session log, learnings, observations. Overflow rolls to @memory. |
| `src/baud/baud/.aipass/` | The branch prompt injected every turn. |
| `src/baud/baud/apps/` | The `drone @baud` CLI shim. |
| `src/baud/baud/FPLAN-*.md` | Open plans. Closed ones are listed in `CLOSED_PLANS.local.json`. |
| `README.md` (root) | **The stranger's page:** what BAUD is, what it needs, the one-line install. The operator's documentation now lives under `docs/`. |
| `install.sh` (root) | The front door, unstamped in the repo; `release.yml` stamps and ships it. |
| `AIPASS_VERSION` (root) | The pair's pin: the aipass version this release installs. |
| `CONTRIBUTING.md` | How to contribute: fork, branch off `dev`, PR against `dev`, and the checks CI runs. |
| `CHANGELOG.md` | Keep a Changelog shape: what each release changed, and the Unreleased lines waiting for the next. Every row that lands adds its line. |
| `SECURITY.md` | The security model (your machine, your tailnet, per-device tokens, what a token reaches) and how to report. Dated; it moves after the scheduled security session. |
| `docs/assets/` | The README's phone screenshots: the wheel hero, the pictures beside each part of What you get (card, room, the monitor wheel over the CPU tile, the three apps), and three spares (the wheel over a live log, settings, git changes). |
| `docs/design/` | Approved design artefacts (the wheel mockup). |
| `docs/architecture.md` | How BAUD reads the fleet, the three rules everything else follows from, the type seam, and the Rust backend's files. |
| `docs/desktop.md` | The desktop window's index: running it, the face's files, the camera, the command surface, the layout, and the table of the pages below. |
| `docs/desktop/window-and-cards.md` | The window, the cards and their doors, the opened passport. |
| `docs/desktop/rooms.md` | Rooms and the seat model, the terminal, the workbench, the bell. |
| `docs/desktop/settings.md` | The card gear, the header gear, the memory dials. |
| `docs/headless.md` | `baud-cli`, the same answers without a window. |
| `docs/development.md` | Building, the checks, the palette as data, and the host seam. |
| `docs/phone.md` | The phone face's index: what the phone is, the transport and its refusal table, the token rule, project-named reads, serving, the checks, the visibility gate, and the table of the pages below. |
| `docs/phone/wheel.md` | The fleet rail, the header name and reload, the verbs and lock chip, the `GIT` tile, the new-project sheet. |
| `docs/phone/card.md` | The expanded agent card, cross-project doors, pane keys, the passport, the manager monitors, the birth certificate. |
| `docs/phone/room.md` | The terminal sheet: attach, geometry, the key bar, scrolling, the standing layout, zoom, fullscreen, stream cost. |
| `docs/phone/room-input.md` | Typing into a room: Enter and bracketed paste, the compose slot, armed typing, the keyboard rule. |
| `docs/phone/room-delivery.md` | Links and copy out of a room, sending a photo, dropped writes, a dead room and its reconnect ladder. |
| `docs/phone/files-git.md` | The git app and the FILES app. |
| `docs/phone/backup.md` | The backup app. |
| `docs/phone/monitor.md` | The monitor row, the cpu page, what is running, rooms and watches that end. |
| `docs/phone/settings-nav.md` | The bell and the feed, the gear, the startup seat, designed reads, settings, Back and tabs. |
| `docs/phone/files.md` | Every file of the phone face, placed: screens and sheets, the git and backup apps, `lib/`. |
| `docs/releases.md` | Versions, what a release carries, and the one human step. |
| `docs/history.md` | How it got here: the milestones and the rounds after them. |
| `docs/phone-setup-android.md` | The stranger's step-by-step for an Android phone: Tailscale, token, sign in. |
| `AGENTS.md` · `CLAUDE.md` | The startup protocol for agents working in this repo. |
| `BAUD_REGISTRY.json` | Machine-managed. Do not hand-edit. |
| `MAP.md` (root) | This file. |
| `app/README.md` | A pointer at the root README and this map. Nothing else lives there. |
| `tests/` (root) | No tests. Its README names where they actually are: `src-tauri/` for Rust, `*.test.ts` beside their modules under `app/src/` for the frontend. |

---

## The mess list — one entry left

Patrick's cadence was *map first, moves second*, and the moves are done. Items 1
to 7 are the tree above:
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
