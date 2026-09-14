# Changelog

All notable changes to BAUD will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and BAUD follows [Semantic Versioning](https://semver.org/). A release is the git
tag `v<version>`. The README's "Versions and releases" section covers the scheme
and how a release is cut. Everything since the last tag sits under Unreleased,
and every change that lands adds its line there in the same sitting.

---

## [Unreleased]

### Added

- **Phone: the cpu page shows the cores** (FPLAN-0586). One bar per core, the thread and core counts with the clock speed, and a plain caption on the load averages. The row that repeated the headline is gone.
- **Phone: the lock chip reads the lock** (FPLAN-0585). It shows locked, unlocked or unknown with a closed or open shackle, and re-reads straight after a tap.
- **Phone: the photo picker takes several photos at once.**
- **Phone: the monitor wheel reads the machine** (FPLAN-0561). Six live cards (cpu, memory, temperature, fan, network, processes) sit on the wheel's last row, which is one flick back because the wheel now loops. Each card has a ring showing where its value sits in its range, and a sheet of real values behind it, read from `GET /v1/machine`. A missing sensor draws a dash, never a zero.
- **Phone: a FILES card.** Browse your home directory, every project and the AIPass repo from the roots the host publishes, and copy any path.
- **Phone: git as the wheel's fourth layer.** Each file's git status rides its row, and the passport is only a passport.
- **Phone: one terminal seat for the whole fleet** (DPLAN-0302). A wheel of agents all point at the same terminal, with the passport on the phone and a bell that keeps counting while it is shut.
- **Phone: the agent watch gains fullscreen, zoom and select-and-copy**, the same controls as the terminal.
- **Phone: the phone face** (DPLAN-0300). An installable web app served by the host API, with read or operate tokens, a real tmux terminal over a WebSocket, photo upload and touch controls.
- **Desktop and phone: resume on a dispatched agent is an intercept.** It stops the working agent in view, then resumes its session by the pointer ai_mail writes at dispatch, where before it guessed from the newest transcript.
- **Desktop: the settings arc** (m13–m16). Chips follow the session rather than the seat, the memory dials join the interface gear, and `baud --snapshot` reads the fleet as one JSON envelope with no window.
- **Design tokens and the transport seam.** Every backend call goes through one typed door, so the desktop and the phone share the same components.
- **`MAP.md`**, one screen showing where every file in the repo lives.
- **`CHANGELOG.md`**, this file.
- **`SECURITY.md`**, which covers the security model in plain words (your machine, your tailnet, a token per device, what a token reaches) and how to report a problem.
- **Issue and pull request templates.** A bug report asks for the build's bundle and tree rows; the pull request template lists the six checks.
- **Dependabot** for npm, cargo and GitHub Actions: weekly, minor and patch bumps grouped per ecosystem, at most three open pull requests each.
- **Frontend tests.** vitest pins the pure derivations beside their modules: the lock chip's faces and sentence, the monitor cards' faces and number formats, the delivery quoting and the copy path. `npm test` runs them.

### Changed

- **CI builds the phone bundle** beside the desktop one, in the same job. Until now, a change that broke only the phone passed green.
- **`.gitignore` also ignores `.env` files, `*.token` receipts and `docs.local/` scratch.**
- **CI runs `npm test`** after the type check and before the builds.
- **Releases also carry the phone bundle**: `baud-phone-<tag>.tar.gz`, the servable `dist-phone/` tree, with its sha256 in the same `SHA256SUMS.txt` as the binary.
- **Phone: the terminal's view chips draw at half fill.**
- **Phone: the header's project name is bound to its slot.**
- **Phone: the terminal opens fully zoomed out.** The zoom chips still cover the full range.
- **Phone: the view chips grew 20%, and the arrow keys moved out of the crowded key belt into that column.**
- **Phone: the wheel lost its notch.** The centred card's glow already marks the selection.
- **Phone: nothing polls while the screen is hidden.** Every lane pauses when the phone is put away and reads once, straight away, when it comes back.
- **Source layout.** The frontend is split into `desktop/`, `phone/` and `host/`, and the Rust backend is split by lane out of `lib.rs`. Behaviour is unchanged.

### Fixed

- **Phone: typing on the soft keyboard works.** Words are no longer dropped, the keyboard no longer squeezes the terminal to one row, and autocorrect still lands.
- **Phone: wheel cards no longer shrink while typing.**
- **Phone and desktop: "Passport no." shows the agent's own id.** It used to show the registry id that every passport shares, which made a fleet audit read as duplicate passports.
- **Fleet: "dispatched" means a live process**, not just a leftover lock file, and an empty room of the agent's own no longer hides a live seat.
- **Tests: the snapshot refusal test builds its own fixture**, so CI no longer needs an AIPass tree around the repo.
- **Backups skip Rust's `target/`**, so backing up BAUD no longer copies tens of gigabytes of build output.

## [0.1.0] — 2026-08-13

The first release: the fleet window, a Tauri 2 desktop app for Linux, built over three days (milestones 1–12). It ships as one Linux binary with `SHA256SUMS.txt`.

### Added

- **The fleet view** (m1). Every AIPass agent appears as a card with live figures. The view only reads.
- **The terminal in the middle** (m2, m6). A real terminal emulator in the centre, where each agent gets its own tmux room, so switching agents detaches instead of killing.
- **Switching, resume, kill and the reading room** (m2.5–m4). Switching agents takes no clicks, every agent can be resumed, and every card has a kill button.
- **Click-through figures** (m4.5). Every number on a card opens the file it came from.
- **The git changes figure and the diff tab** (m5).
- **The project switcher** (m7). Point the fleet view at any sealed project.
- **The screenshot button, drag-and-drop paths and the sub-agent badge** (m8).
- **Auxiliary panes** (m9). The prax monitor and commons feed toggles, a watch pane per card, and a help door that opens a shell at `drone @<agent> --help`.
- **The notification bell** (m10), which replaces desktop toasts.
- **Settings** (m11). A gear per agent, and one for BAUD's own interface.
- **Ended rooms stay dead** (m12). Sessions started outside BAUD surface and can be ended.
- **Whole-window zoom, ctrl+click terminal links, and slash-command chips** for `/memo`, `/prep` and `/compact`.
- **Product basics.** A version scheme, the CI lane, a tag-driven release workflow and the MIT licence.

### Fixed

- **Mail counts** read the mailbox itself instead of the dashboard's cached count.
- **Slash-command chips** submit with a carriage return, so the command runs instead of sitting in the box.
- **The sub-agent badge** counts agents running in the background.
- **The help door** on the aipass card asks aipass's own binary.
- **Path-resolution tests** build their own fixture tree, so they pass on a bare CI runner.

[Unreleased]: https://github.com/AIOSAI/baud/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AIOSAI/baud/releases/tag/v0.1.0
