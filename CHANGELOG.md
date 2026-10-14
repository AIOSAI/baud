# Changelog

All notable changes to BAUD will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and BAUD follows [Semantic Versioning](https://semver.org/). A release is the git
tag `v<version>`. `docs/releases.md` covers the scheme
and how a release is cut. Everything since the last tag sits under Unreleased,
and every change that lands adds its line there in the same sitting.

---

## [Unreleased]

### Changed

- **Guide step 5 opens with the no-QR case.** The owner's own run of the public one line in a Docker container (test 13, 2026-10-13) ended with `Server: not answering` and no QR, because a machine without systemd cannot have the server started for it; the guide said "hold your phone up" and nothing said up to what. Step 5 now names that line, the reason, and the two commands that start the server and mint the code (in a new terminal, or after `exec bash`), before the camera.

## [0.3.2] — 2026-10-13

### Added

- **Phone: QR pairing (DPLAN-0406).** A phone that opens the machine's pairing link (`/#pair=<code>`, a QR from the installer's last block or `drone @api host-api pair`) signs itself in. The face removes the code from the address bar and history before the first paint, redeems it once at `POST /v1/pair`, stores the returned token exactly as a pasted one, and proves it with whoami. A stored, working token wins, and the code is not spent. A refused code puts "This pairing code has expired or was already used", with the command for a fresh one, above the paste field, which stays as the fallback. Nothing answering keeps the door's unreachable line. New: `redeemPairing` in the HTTP transport and `phone/lib/pairing.ts` with its tests.
- **`docs/uninstall.md`:** every file and line an install puts on the machine, and how to take each off.

### Changed

- **`AIPASS_VERSION` 2.8.15.** The installer pins the AIPass release that carries the pairing door (`drone @api host-api pair`, `POST /v1/pair`) and the install's closing QR.
- **`package.json` and `Cargo.toml` carry `license: MIT`**, matching the repo's LICENSE; npm and cargo metadata said nothing before.
- **`install.sh`: the closing line after a failed `sudo tailscale up` no longer says Tailscale "was skipped".** It now reads "Tailscale is not connected here" and tells the user to install it only if it is missing, which fits both the declined and the failed path.
- **The Android guide pairs instead of pasting.** Steps 5 and 6 are now "hold your phone up": scan the QR and tap the link. The paste path remains under "When the code has expired".
- **SECURITY.md: a Pairing entry.** It covers the one-use, five-minute code, sha256 stored, the bearer minted at redeem, no receipt file for a paired token, the same `list-tokens`/`revoke-token`, and that whoever scans the screen within five minutes can pair.
- **README: the phone signs in by scanning, not pasting.**
- **`install.sh`: the closing block ends in one undo pointer** to `docs/uninstall.md`, so the pairing QR that `aipass install` prints last stays on an 80x40 screen. A failed install still prints the whole list.

## [0.3.1] — 2026-10-13

### Fixed

- **`install.sh`: apt never prompts.** apt runs with `DEBIAN_FRONTEND=noninteractive`, carried through sudo, so tzdata no longer stops a terminal install to ask for a timezone.
- **`install.sh`: a failed `tailscale up` no longer stops the install.** It prints one line saying to run `sudo tailscale up` later and continues as if Tailscale was skipped.
- **`install.sh`: the closing line tells the truth about the phone face.** It checks the face on disk and, when it is absent, says AIPass is installed but the face is not, with the retry command.
- **`install.sh`: the phone guide URL prints in every ending**, not only when Tailscale was skipped.
- **`install.sh`: the undo list names what `setup.sh` wrote**: the `/usr/local/bin` links, the `~/.bashrc` lines, the `~/.claude/settings.json` hooks, env entry, permission rules and `includeGitInstructions` value, `~/.claude/commands/memo.md`, `~/.secrets/aipass` and `~/.aipass/trusted_projects.json`.
- **`install.sh`: Claude Code sign-in is skippable.** Answering no continues the install, and the closing block says to run `claude auth login` before `claude`.

### Changed

- **`install.sh` is stamped to AIPass 2.8.14** (`AIPASS_VERSION`), up from 2.8.13.

## [0.3.0] — 2026-10-13

The first release a stranger installs: one line, `install.sh`, stamped to this tag and to AIPass **2.8.13**, the first `aipass` whose `install` takes `--baud-tag` and ends on the phone step.

### Added

- **Phone: links in a room open on a tap**, and a links panel lists the room's URLs with open and copy; a copy says whether it landed and shows the text to copy by hand when it cannot know.
- **Phone: a BAT card on the monitor wheel.** The battery's charge with a ring, a mark when plugged in, and warm or hot only against the low and critical lines the host publishes while discharging; its sheet shows state, time left and those lines.
- **The front door: `install.sh`.** One line installs BAUD with AIPass on a Linux x86_64 machine. It checks what is there, installs what is missing with your yes, and ships with each release stamped to that release, sums checked.
- **The README is the page a stranger reads.** The operator's documentation moved verbatim to `docs/` (architecture, desktop, headless, development, phone, releases, history); `docs/phone-setup-android.md` and `CONTRIBUTING.md` are new.

### Changed

- **Public-day text.** `SECURITY.md` reports vulnerabilities through GitHub's private vulnerability reporting instead of a `[security]` issue, and no page calls the repository private any more (`docs/releases.md`: the version stays on `0.x` while BAUD is pre-release).

## [0.2.1] — 2026-09-14

### Added

- **`baud-cli`, the headless binary** (FPLAN-0589). The same crate and the same reader as `baud`, built with the new `gui` cargo feature off: the six headless verbs (`--snapshot`, `--list-projects`, `--roster`, `--end-room`, `--capture-room`, `--send-room`) with the same arguments, output and exit codes, no window, and no GTK, webkit, javascriptcore or soup linked. A server or container with no desktop can answer the host API's fleet, census, roster and room lanes, and the API prefers it to the desktop binary. Releases carry it as `baud-cli-<tag>-linux-x86_64` with its sha256 in `SHA256SUMS.txt`, and CI fails if `ldd` shows it linking a GUI library.

## [0.2.0] — 2026-09-14

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

[Unreleased]: https://github.com/AIOSAI/baud/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/AIOSAI/baud/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/AIOSAI/baud/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/AIOSAI/baud/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/AIOSAI/baud/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/AIOSAI/baud/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AIOSAI/baud/releases/tag/v0.1.0
