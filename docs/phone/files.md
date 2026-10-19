# The phone face's files

This page places every file of the phone face: the screens and sheets, the git and backup apps, and the no-JSX logic in `lib/`. Paths are under `app/`.

← [the phone face](../phone.md)

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
| `MonitorSheet.tsx` | Logs. A dropped watch wears the room's dead overlay and climbs the room's reconnect ladder. |
| `MachineSheet.tsx` | What a monitor card opens to: the machine's live vitals, and the skill's own sentence for anything this host cannot read. The PROC sheet also lists the top 20 processes, read once per open and on a tap. |
| `TokenDoor.tsx` | The paste-a-token screen. Nothing renders until it passes. |
| `VerbChips.tsx` | The operate-scope buttons and their refusals. |
| `NewProjectSheet.tsx` | What the switcher's `+ new project` row opens: a name, a template chip, one `create`, and the host's sentence verbatim on a refusal. |

**The git app — `src/phone/git/`** — a sub-app with its own screens:
`GitApp.tsx` (the door) → `GitChangesScreen.tsx`, `GitCommitsScreen.tsx`,
`GitCommitScreen.tsx`, `GitDiffScreen.tsx`, with `GitFileRow.tsx` as the shared
row.

**The backup app — `src/phone/backup/`**: `BackupApp.tsx`, one
screen of status lines and four lane presses for the seated project (a running
press becomes Stop, with a progress block per lane in flight), and
`backupView.ts` with its test, which holds the sheet's words, its
ask-before-sending rule and its Stop/progress/outcome rules, pure.

**Logic modules — `src/phone/lib/`, no JSX** — the pieces screens share:

| File | One line |
|---|---|
| `verbs.ts` | What each scope may do, and the sentence when it may not. |
| `newProject.ts` | The new-project sheet's rules: the name rule (the host's, mirrored), its hint, the two templates, the phone-side refusal, and the manager's card built from the host's answer. Pure, plus `newProject.test.ts`, which also drives `verb_new_project` through the transport with `fetch` stubbed. |
| `rooms.ts` | Which door a card's state means; the room's own vocabulary. |
| `gitStatus.ts` | git's two-column code → the chip letter. One mapping, both screens. |
| `gitWords.ts` | The git app's small rules and words: where a changed row's tap goes (an untracked file is read, an untracked directory answers under its row or, at repo grain under a named root, opens the files door; `rootAddress` spells that root for the files lane), a commit message without its subject line, the merge's no-files line, the no-agent line by whether the fleet answered, and the no-remote read of contract C-D. Pure, plus `gitWords.test.ts`. |
| `feed.ts` | The feed window size, retention, and the merge rule the badge and the screen share. |
| `feedMarks.ts` | The bell's read and cleared markers: one machine-wide key each (the feed takes no project), and the one-time lift of the seated project's old per-project mark. Pure over an injected store, plus `feedMarks.test.ts`. |
| `trail.ts` | The back rule's trail: the screens left through a door, newest last - the card, the files roster, the passport - one step back, and the word each `‹` shows for where it lands. Also the `Browse` type the trail and a file pane's `from` share. Pure, plus `trail.test.ts`. |
| `tabStore.ts` | The tab row kept across a reload: the panes, the front tab and the focus history in localStorage beside the seat, read back and checked against the first census (a tab whose agent left is dropped with one console line), folded under anything opened meanwhile; and which tab a close fronts (the one before it, not the rightmost). Pure over an injected store, plus `tabStore.test.ts`. |
| `systemBack.ts` | The phone's own Back: open screens register the handler their `‹` calls, and one guard entry in history runs the newest on Android Back; at rest there is no entry and Back is the browser's. The registry and the guard are pure, plus `systemBack.test.ts`; two thin hooks wire them. |
| `whileVisible.ts` | The polling gate: no lane on this face ticks while the screen is away. |
| `machine.ts` | The monitor row's lane: `GET /v1/machine`, read only while that row is the visible wheel, and the ONE derivation of what each card face and the sheet draw from it. Not in `pollers.ts` because it is gated on a layer, not on the shell. |
| `processes.ts` | The PROC sheet's list: the cpu/mem order of the same twenty rows, a row's name (or its pid), and the sampled line - pure, plus `processes.test.ts`. |
| `socketClose.ts` | What a closed room or watch socket means - 4000 ended, 1008/1011 refused, anything else dropped - which of those stop the reconnect ladder, and the dead overlay's words for both sheets. Pure, plus `socketClose.test.ts`. |
| `battery.ts` | The BAT card's face and the battery sheet's time-left words - pure, so its test stands up neither react nor the host transport. `machine.ts` calls it from the one derivation. |
| `lock.ts` | The header lock chip's lane: `GET /v1/lock` every 5 s while the app is looked at, re-read at once and 1 s after a tap, forgotten when the app goes away - and which of four faces (unread, unlocked, locked, unknown) a reading means. |
| `pollers.ts` | **All four polling lanes**, as hooks: the fleet read, the per-branch change sweep, the bell's badge, the repository count. Each owns state nothing else writes — which is why they could leave the shell at all. |
| `copyPath.ts` | floor + relative → a machine path, the two clipboard lanes, and `copyShown`, the truthful answer the two path buttons give (a tick only for a confirmed copy, the path held out for a long-press otherwise). |
| `mailFigure.ts` | The agent card's MAIL tile, "N new · M opened", so the tiles add up to the rail's badge. Pure, plus `mailFigure.test.ts`. |
| `roomLinks.ts` | Every http(s) URL in a room's rows, joined across soft and hard wraps - the ONE detection behind the terminal's tap-to-open link provider and its links panel. |
| `push.ts` | The push hook, inert until phase 7. |
| `pairing.ts` | The pair link, read and stripped from the address bar, and the one arrival decision (a stored token wins, the code is redeemed once, refused and unreachable kept apart), pure, with the fetches injected; plus `pairing.test.ts`. |
| `lock.test.ts` · `machine.test.ts` · `battery.test.ts` · `copyPath.test.ts` · `roomLinks.test.ts` | vitest pins of what those modules promise - pure functions only, no DOM, no network. `npm test` runs them. |
