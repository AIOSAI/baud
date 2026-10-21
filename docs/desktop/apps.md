# The apps

This page covers the four app cards at the end of the fleet strip, GIT, FILES, BACKUP and MACHINE, and how each one hosts the phone's own screen in a workbench tab.

← [the desktop window](../desktop.md)

## The app cards

After the agent cards, under their own `Apps` heading, the strip carries four
cards: GIT, FILES, BACKUP and MACHINE. Each is a glyph and a name in the phone's
app accent, with no lamp: an app has no session to light. A click opens the
app's workbench tab, or fronts it when it is already open; there is one tab per
app, whatever the seat. GIT, FILES and BACKUP carry the seated
project by name, never an empty project, which the host would read as its own
default seat. Until the seat is read the cards are disabled and their hover says
so.

## One tab, the phone's screen

Each tab mounts the phone's own screen, unchanged, inside the workbench, and
only while it is the front tab: a screen reads on mount, so fronting a tab
refreshes it. The screens call the same `/v1` routes as the phone, through the
desktop's relay (`host_api_call`), so both faces show the same answers and the
same refusals.

- **GIT** is the git app at repo grain: the changes with untracked files by
  name, a file row's diff, the log and the remote. It is addressed by the seated
  project's manager card, as the phone's is, read from one fleet snapshot when
  the tab mounts; the changes count is the phone's own slow repo count.
- **FILES** is the phone's roots (branch, project, aipass, home), the browse
  under a picked root, and the reader, as one stack inside the tab. A file opens
  in the reader, with a preview for markdown; the reader's `‹ folder` returns to
  the folder it was opened from, the browse's `‹ roster` at its floor returns to
  the roots, and the roots' `‹` closes the tab.
- **BACKUP** is the backup app for the seated project, with the relay token's
  `operate` scope: the store, the last runs, the Drive setting, Snapshot now
  and its summary, a running lane's progress and Stop.
- **MACHINE** is the monitor row as seven tiles (CPU, MEM, TEMP, FAN, NET, PROC,
  BAT) with their live readings, polled every two seconds while the tab is in
  front. A tile opens the phone's machine sheet: the CPU sheet shows the cores,
  PROC the top twenty processes. Under the sheet one line reads the lock state.

## What differs from the phone

- **Width.** The screens fill the workbench pane rather than a phone's column.
- **Tabs, not overlays.** Each app is a workbench tab beside the terminal and
  the other tabs; the tab's ✕ closes it from any depth, and each screen's own
  `‹` at its floor closes it too.
- **The lock line has no lock verb.** The desktop is the screen being locked, so
  MACHINE reads the lock state and offers nothing to set it.
- **Back words.** The screens keep the phone's own back words: the floors of
  GIT, FILES and BACKUP say `‹ wheel` and close the tab, and the machine sheet's
  `‹ wheel` returns to the tiles, whose own `‹ close` closes the tab.
