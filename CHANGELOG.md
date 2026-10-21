# Changelog

All notable changes to BAUD will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and BAUD follows [Semantic Versioning](https://semver.org/). A release is the git
tag `v<version>`. `docs/releases.md` covers the scheme
and how a release is cut. Everything since the last tag sits under Unreleased,
and every change that lands adds its line there in the same sitting.

---

## [Unreleased]

### Added

- **Desktop: every phone lane through one Rust relay.** `host_api_call` (`host_relay.rs`) forwards a fenced `/v1` request (GET or POST, path under `/v1/`) to the host API at the bind in @api's config store, with a `baud-desktop` operate token it mints once into a receipt and keeps out of the page. `transport.ts` picks the door per call with `routeOf`, by the call's shape: desktop-shaped calls stay on IPC; a call naming a project or root, a relative path, or a phone-only verb goes over the relay. `transport.http.ts` keeps one parser (`callWith`) behind an injectable sender. The CSP, the capability grant and the phone bundle are unchanged. The desktop's refusal table is gone except the room socket and the image upload.
- **Desktop: four app cards on the strip.** GIT, FILES, BACKUP and MACHINE sit after the agent cards under an `Apps` heading. Each opens one workbench tab holding the phone's own screen over the relay: the git app at repo grain, the roots, browse and reader stack, the backup app with `operate` scope, and the machine's seven monitor tiles over the phone's machine sheet with one line of lock state (no lock verb: the desktop is the screen). A tab renders only while in front, so fronting it refreshes it.
- **Desktop: the card's figures open designed screens.** `mail` and `open` open the inbox screen, `plans` the plans screen, `todos` the memory screen on its todos tab and `⎇ git` the git app on the branch, each in a tab keyed by agent and project. A roster card from another project opens the same reads with its own project named, its `files` as the phone's files screen, and its `?` and `watch`; its git count reads `n/a` rather than `0` when the relay cannot answer. Only its gear stays fenced, drawn dashed, with a line on the card saying why.
- **Desktop: `+ new project` in the project switcher.** The menu's last row opens the phone's new-project sheet; on create the window seats the project by the census name the host returns and opens its manager's card door (`fresh` for a newborn).
- **Desktop: pair a phone and About in the header gear.** `pair a phone` opens a terminal tab already running `drone @api host-api pair phone --scope operate`, which draws its own QR; `about` shows the app's version.
- **Desktop: a bell mail row opens its message.** A row carrying `mail_id` and `recipient` opens the recipient's inbox screen on that message in a tab. The bell's cleared mark is one machine-wide key, adopting the seated project's old per-project mark once. The Rust feed reader keeps the three address fields it used to drop.

## [0.5.0] — 2026-10-19

### Added

- **The README explains before it installs, with screenshots.** What BAUD is and that it installs AIPass come first, then the wheel as the hero, and each part of What you get (the card, rooms, the machine, the files, git and backup apps) carries its own phone screenshot from `docs/assets/`. Tailscale is named as needing an account, the desktop app as under development and run from source, and Android as the tested phone. The machine readings no longer list disks, which the monitor has no card for. Written by Vera Studio on the owner's ask.
- **Phone: an untracked file or folder opens from the wheel's git app.** At repo grain a `??` file opens in the Reader and a `??` folder opens the files door there, through the files root `/v1/git-changes` now names (the AIPass repo, or the seated project's). A nested tree no root holds keeps its words under the row.

### Security

- **Desktop: a watch target may not start with `-`.** The monitor pane's target is one argv word for `drone @prax monitor run`, and its charset fence admitted a leading dash, so `--relay` would have reached prax as an option and switched on its Telegram relay. The fence now refuses an option-shaped target, matching the host API's own refusal.

### Fixed

- **Agent settings name the card's project.** The settings sheet sends the agent's project with its branch, on the read's query and in the write's body, so an agent of another project (vera under VERA-STUDIO) opens and saves instead of answering "Unknown branch". A card with no project sends none, which the host reads as the seat, and the desktop's calls are unchanged. The gear stays fenced on a card from outside the seat, because the sheet's memory dials still name no project.

## [0.4.0] — 2026-10-18

### Added

- **Phone: a Backup card on the apps wheel (DPLAN-0411).** `BKP` sits after git and files. Its sheet reads the seated project's store (when each lane last ran, with file counts, and the Drive sync setting, plus store sizes on request) and offers four presses: Snapshot now, Versioned now, Full backup and Sync to Drive. Each press runs through the host API's backup door and shows the command's own summary when it ends. Sync to Drive, and Full backup with Drive on, ask once before sending. The desktop refuses the three backup calls by name.
- **Phone: the Backup card shows each run's progress and can stop it (DPLAN-0412).** While a lane runs, the sheet shows a bar, files done of total, bytes copied (of the planned bytes when known), time elapsed and the file in flight, for runs started from a terminal or the daemon too; under Full backup it names the sub-lane at work. A running press becomes Stop, which ends the run cleanly without a confirm; a read token is refused it by name. A stopped run reads "stopped" in the dim colour over its summary, not as a red failure, and a Drive run that cannot fit leads with its own sentence ("Drive has 1.4 GB free; this run needs 2.9 GB. Nothing uploaded.") instead of a generic "failed". The desktop refuses the new stop call by name.
- **Phone: an inbox screen behind the MAIL tile (DPLAN-0414).** The agent card's MAIL tile opens the agent's messages as a list, newest first, with sender, subject, age and an unread mark under a "N unread · M total" head. A tap on a message shows its full text, wrapped, under its subject, sender and time.
- **Phone: a plans screen behind the PLANS tile (DPLAN-0414).** The PLANS tile opens the agent's active plan count, its open plans and its recently closed plans, each with its id, subject and age, and says "no open plans" or "nothing closed lately" when a list is empty.
- **Phone: a mail notification opens its message (DPLAN-0414).** A mail row in the feed that carries the message's id and recipient opens that message's full text; back returns to the feed. A message no longer in the inbox says so in one line. Older rows, wakes and dispatches stay as they were.
- **Phone: the processes sheet lists what is running by cost (DPLAN-0414).** The PROC card's sheet shows the twenty busiest processes with cpu %, memory % and memory MB, read once when the sheet opens and again on a tap on its sampled line, never polled. A cpu/mem toggle re-orders the same twenty. While the host samples (about half a second) the line says "sampling…"; a refusal shows the same sentence the vitals refusal shows; a process with no name shows its pid. The desktop refuses the new call by name.
- **Phone: a dropped watch is marked dead and comes back by itself (DPLAN-0414).** A watch whose socket drops dims its last frame under the room's overlay and reconnects on the room's ladder. Its button reads "rewatch mission control" or "rewatch <name>" and shows only after a close, never while the watch is still connecting.
- **Phone: a startup agent that does not open says why (DPLAN-0414).** The resting stage shows "startup agent X not opened — <reason>" when the token is read-only or the agent has no card in the seated project.
- **Phone: the phone's own Back goes back one screen (DPLAN-0414).** Android Back and the edge swipe do what the screen's `‹` does, one level at a time, folders, the inbox, the git app and settings sections included. On the wheel with nothing open, Back is the browser's as before.
- **Phone: open tabs come back after a reload or an app restart (DPLAN-0414).** The tab row, the tab in front and the order tabs were used in are kept on the phone. A room tab reattaches without typing anything, a file tab re-reads, and a tab whose agent is gone is dropped.
- **Phone: a "+ new project" row in the project switcher (FPLAN-0649).** The last row of the header's project menu opens a small sheet: a name field with its rule under it (letters, digits, _ and -, starting with a letter), `empty` and `python` template chips (`empty` selected), and one `create` button that reads "creating…" while the host makes the project. A refusal shows the host's sentence and the sheet stays open; on success the phone switches to the new project, by the name the switcher lists it under, and opens its manager's room. A read token is refused it with the verb chips' reason, and the desktop refuses the new call by name.
- **Phone: the Backup card names its project and shows its path (DPLAN-0414).** The head shows the seated project's name and, once the store answers, its root path. Switching project in the header switches both, and the old project's path is never shown under the new name.

### Changed

- **Installs pin AIPass 2.8.21.** `AIPASS_VERSION` moves from 2.8.17 to 2.8.21, the release whose host API pages `/v1/dir` with `offset` and `total`, which the phone's Files screen asks for.
- **Phone: the TODOS tile opens the memory screen on its todos tab (DPLAN-0414)** instead of the raw memory file. The memory door still opens on sessions.
- **Phone: README and other `.md` files read as formatted documents (DPLAN-0414).** Headings, lists, code blocks, tables and links are drawn; links open in a new tab; raw HTML in a file shows as text. This adds the `marked` package (18.1.1, pinned).
- **Phone: an empty file says "this file is empty"** instead of showing a blank screen.
- **Phone: `▸ resume ⚡` asks for a second tap (DPLAN-0414).** The door shows its warning under the room doors; the first tap arms it, and a second tap within four seconds stops the working agent and resumes its chat. Any other tap cancels.
- **Phone: the processes count reads "processes" (DPLAN-0414).** It counts every process, sleeping ones too, so the sheet no longer calls it "running", and the "deferred row" line is gone.
- **Phone: a mail notification that names its project opens that project's inbox (DPLAN-0414).** Notifications without a project still find the recipient through the seated project, then the roster.
- **Phone: the agent card's MAIL tile reads "N new · M opened" (DPLAN-0414)**, so the tiles add up to the rail's badge.
- **Phone: the interface door says "poll every", "bell keeps" and "bell chime" apply to the desktop only (DPLAN-0414).**
- **Phone: the memory screen points per-agent limits at the card's gear (DPLAN-0414)** instead of saying they are still to come.
- **Phone: reasons that lived only in hover text are shown on screen (DPLAN-0414).** The room doors under a read token, the header lock chip's answer, the GIT tile's `n/a`, a refused manager monitor and the cross-project roster's refusal each show their reason as a small line. A tap on a passport number shows the full id.
- **Phone: `copy` and `copy path` say "copied" only when the clipboard confirms it (DPLAN-0414).** Over plain http, where the browser may copy nothing, the screen says so and shows the path to long-press and copy.
- **Phone: going back from a file opened in a folder returns to that folder (DPLAN-0414).** The file stays open as a tab; files opened from anywhere else close on back as before.
- **Phone: an untracked file in the agent card's GIT list opens in the reader (DPLAN-0414)**, and a new directory says "new directory — nothing to diff; browse it from the files door" under its row instead of opening a refusal.
- **Phone: back from a screen opened on the agent card returns to the card (DPLAN-0414).** README, inbox, plans, todos, memory, files, agent settings and passport all go back to the card they were opened from. Room, shell and watch doors still close the card.
- **Phone: a files browse goes back to where it was opened (DPLAN-0414).** From the top folder, back returns to the files roster, the passport or the agent card. Picking a place on the roster no longer discards the roster, and a file tab's back to its folder brings that path back too.
- **Phone: the passport's close returns to the agent card (DPLAN-0414)** when the card opened it.
- **Phone: every back button names where it goes (DPLAN-0414):** `‹ wheel`, `‹ card`, `‹ roster`, `‹ folder`, `‹ passport`, `‹ feed`, `‹ inbox`, `‹ settings`. The settings home's `‹ close` reads `‹ wheel`.
- **Phone: one close glyph, `×`, across the face (DPLAN-0414).** The passport and every settings panel use the tab's `×`. In BAUD settings, the interface section's `×` and click-away close settings, like the home's; Escape and `‹ settings` still go back one level. The desktop keeps `✕`.
- **Phone: closing a tab brings back the tab you were on before (DPLAN-0414)**, not the rightmost one.
- **Phone: the Backup card picks up runs started elsewhere (DPLAN-0414).** While nothing runs, the sheet re-reads the store every 10 s while it is open and on screen, so a run from a terminal or the daemon shows its bar and its Stop.
- **Phone: a running backup's progress line counts failed files (DPLAN-0414)**, ending "· N failed" when any have failed.
- **Phone: the end-room dialog says the tap is the confirmation (DPLAN-0414).** Over plain http no fingerprint is asked, and the answer line says "verified by this device" only after a real fingerprint or face check.
- **Phone: a `.md` file opens raw, with a `preview` button beside `copy path`.** The button draws the document and reads `raw` to switch back. The preview adds `<details>` blocks, GitHub alerts and inline images with absolute `http(s)` addresses, and `dompurify` 3.4.17 now cleans every render, raw HTML in the file included, so a file's script, handlers and styles never run or show.
- **Phone: a long directory pages instead of dropping its tail.** Over a host that sends `total`, the Files screen shows "400 of 1059 shown" and a "show more (659 left)" row that fetches the next page with `offset`. Over a host without `total` it says "the first 400 shown - this host does not list further" in a quiet line, in place of the amber notice.
- **Desktop: ashpd 0.13.** The screenshot portal is its own cargo feature in 0.13, so the `gui` build enables `screenshot` beside `tokio`. The capture call is unchanged.
- **Build: vite 8, with `@vitejs/plugin-react` 6 and vitest 5.0.5.** plugin-react 6 is the line that accepts vite 8; both configs build both faces unchanged.

### Removed

- **Phone: the `tree` row in Settings › About (DPLAN-0414).** The version and bundle rows stay.

### Fixed

- **Phone: every refusal ends with its reference, e.g. "(ref a1b2c3d4e5f6)" (DPLAN-0414)**, so the reason can be found in the host's log.
- **Phone: a commit shows its subject once (DPLAN-0414)**, and a merge says "this merge changes no files of its own" instead of an empty file list.
- **Phone: the git sheet says "no agent in this project to read the repository through" (DPLAN-0414)** when the project has no agents, instead of blaming a fleet read that landed.
- **Phone: a repository with no remote reads "no remote configured — no links" (DPLAN-0414)** once the host API answers that way; a refused remote read still shows its refusal.
- **Phone: home, project and aipass folders say "git status is not shown here" (DPLAN-0414).**
- **Phone: a room that ended says "ended" and stays ended (DPLAN-0414).** When the host closes a room with "room ended" (from the desk, or a shell that exited), the overlay reads "ended — this room is gone; open it again from the card to start fresh" and the phone does not reattach into a fresh empty room under the same name. A watch that ends says "the watch ended" and does not re-arm.
- **Phone: a room the host refuses stops retrying (DPLAN-0414).** An unknown branch or project, or a host without tmux, shows "refused" with the host's sentence instead of looping as "detached, still running". The launch line is typed on the room's first frame, so a refused try no longer uses it up.
- **Phone: a rejected token at room open keeps its sentence (DPLAN-0414)** instead of being replaced by "the room did not answer".
- **Phone: `end room` is remembered (DPLAN-0414).** A room ended from the phone, or one that ended under its socket, is not reopened by the startup agent on reload; opening it from its card clears the mark.
- **Phone: the attached ring follows the agent room (DPLAN-0414)**, not whichever tab is in front.
- **Phone: Settings › memory no longer warns "enforcement is OFF" or shows a route as the file path (DPLAN-0414).** The phone cannot see the enforcement hook or the file, so it shows neither; the desktop is unchanged.
- **Phone: Settings › memory's caps section reads "character caps are set at the desktop" (DPLAN-0414)** instead of a heading with nothing under it.
- **The memory push confirm says "every branch" when no branch has an override (DPLAN-0414)**, on both faces, instead of a guessed "ALL 17 branches"; with overrides it still names their count.
- **Phone: the bell's read and clear marks hold across projects (DPLAN-0414).** The feed is machine-wide, so the marks are one key each: switching project no longer brings read events back as unread, and a clear clears them everywhere. The seated project's old marks carry over once.
- **Phone: the live and dispatched wheels say "reading…" while the roster loads (DPLAN-0414)** instead of "lane pending".
- **Phone: the Backup card with no project seated says "no project is seated yet" (DPLAN-0414)** instead of "reading the store…" forever.
- **Phone: the Backup card says when a project has no backup store (DPLAN-0414):** "this project has no backup store yet — register it with drone @backup register <root>", instead of three lanes that look as if they never ran.

## [0.3.7] — 2026-10-15

### Fixed

- **The release stamp passes shellcheck again.** v0.3.6's release run failed at "Stamp the installer": `install.sh` passed the sandbox's `--source PATH` as one unquoted `$src_opt` word and shellcheck's SC2086 refused it, so no v0.3.6 assets were published (the tag stands, pointing at the unreleased commit). The flag and its value now ride as two `${AIPASS_SOURCE:+...}` expansions, each its own word, so a path with a space holds too. Same contents as 0.3.6 otherwise.

## [0.3.6] — 2026-10-15

### Added

- **The install sandbox** (`docker/sandbox.sh`, DPLAN-0408). The owner, after three releases in fifty minutes for two text fixes: "i cant wait over an hour every change. we need to pull local for our testing." One host command builds a `baud-sandbox` image once (a stranger's Ubuntu: sudo, curl, a user, Tailscale installed, `tailscaled` started by the entrypoint; nothing the installer itself installs) and starts a fresh container from it with the AIPass checkout mounted read-only at `/src/aipass` and a stamped copy of the local `install.sh` at `/src/baud/install.sh`. Inside, the one line is `curl -fsSL file:///src/baud/install.sh | sh`. `install.sh` gained a local mode: with `AIPASS_SOURCE` set it builds the aipass CLI from a clone of that checkout and passes `--source` to `aipass install`, so only committed, tracked files ever cross (the owner: "only match the repo files, no pulling any wrong files over"). `--keep-logins` keeps the Tailscale and Claude Code sign-ins between runs; the default is the stranger's fresh run. `docs/sandbox.md` has the loop.

### Changed

- **`AIPASS_VERSION` 2.8.17.** The installer pins the AIPass release that carries `aipass install --source`, the sandbox's door, and the backed-up, receipted writes to the personal Claude settings file (`~/.claude/.backup/settings/`). There `aipass doctor --fix` asks before it writes; the installer's own preflight writes once, with a receipt, so the one Enter stays one Enter.

## [0.3.5] — 2026-10-13

### Changed

- **When no QR prints, the last lines are the whole solution.** Three pasteable lines (the `AIPASS_HOME` export, `serve --detach`, `pair phone --scope operate`) and what to do with the QR they print, no "its reason is above": nobody reads an install's output, they read its end (the owner, test 14). The skipped path (no Enter) prints the same three lines for later.

## [0.3.4] — 2026-10-13

### Fixed

- **The pairing QR could not be made from `install.sh`** (the owner's test 14, 2026-10-13). `drone` finds the core branches through `AIPASS_HOME`; setup.sh had just written it into `~/.bashrc`, but the script's own shell started before that and never had it, so `drone @api host-api pair phone` answered `Branch '@api' not found in registry` and the run ended on the retry hint instead of the QR. The script now exports `AIPASS_HOME` to the home it just installed before the pause. The retry lines start with that export, since the terminal that ran the one line is in the same position; a new terminal has it from `~/.bashrc`.

## [0.3.3] — 2026-10-13

### Changed

- **`AIPASS_VERSION` 2.8.16.** The installer pins the AIPass release where `aipass install --non-interactive` never mints a pairing code and starts the host API itself on a machine without systemd, so this script's own pause and QR are the one pairing moment.
- **Guide step 5 opens with the no-QR case.** The owner's own run of the public one line in a Docker container (test 13, 2026-10-13) ended with `Server: not answering` and no QR, because a machine without systemd cannot have the server started for it; the guide said "hold your phone up" and nothing said up to what. Step 5 now names that line, the reason, and the two commands that start the server and mint the code (in a new terminal, or after `exec bash`), before the camera.
- **`install.sh` asks once.** After the table it lists everything it will install, each row naming its installer and whether it uses sudo, plus the sign-ins still due, and waits for one Enter; then every missing row installs and the Claude Code and Tailscale sign-ins run with no further question. The owner's run of the public one line (test 13, 2026-10-13) asked a yes for git, tmux, curl, uv, Claude Code, its sign-in, Tailscale and `tailscale up`, and an "n" on a required row failed the run. The owner's words: "list all we will be installing, press enter to start install". A sign-in that does not finish is noted and the install goes on; the closing lines name it, as before. Re-running the one line resumes, since the table skips what is present. The script now mints the pairing QR itself, last: after the undo pointer it waits for Enter when the phone's camera is ready, so the code's five minutes no longer run out while the person is still at the Tailscale sign-in. When the code cannot be made, it names the two commands that start the server and try again.

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

[Unreleased]: https://github.com/AIOSAI/baud/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/AIOSAI/baud/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/AIOSAI/baud/compare/v0.3.7...v0.4.0
[0.3.7]: https://github.com/AIOSAI/baud/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/AIOSAI/baud/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/AIOSAI/baud/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/AIOSAI/baud/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/AIOSAI/baud/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/AIOSAI/baud/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/AIOSAI/baud/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/AIOSAI/baud/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/AIOSAI/baud/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/AIOSAI/baud/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AIOSAI/baud/releases/tag/v0.1.0
