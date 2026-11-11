# The apps

This page covers the wheel's app and monitor cards, the FILES tree they dock and the four tabs they open (GIT, BACKUP, MACHINE and BROWSER), and how each tab hosts the phone's own screen.

← [the desktop window](../desktop.md)

## The app cards

The wheel's `apps` layer carries four app cards, GIT, FILES, BACKUP and
BROWSER (its mark reads `WEB`); its `monitor` layer carries the seven machine cards, CPU to BAT, with
their live faces. The centred card opens (see
[the wheel](window-and-cards.md#the-wheel)):

- **FILES** docks the file tree on the left, seated at the project root the
  snapshot names, the same tree a passport's `files` door docks for a branch. A
  folder expands in place, a file opens as a tab on the right, and opening FILES
  again closes the tree. Until the snapshot names the root it opens nothing.
- GIT and BACKUP open their own workbench tab, and every monitor card the one
  MACHINE tab. A tab already open is fronted; there is one tab per app, whatever
  the seat. GIT and BACKUP carry the seated project by name, never an empty
  project, which the host would read as its own default seat, so until the seat
  is read they open nothing. The GIT card's badge is the repository count, read through the seated
project's manager.
- BROWSER opens the one BROWSER tab. Like MACHINE it is machine-wide: it names
  no project, and a seat change leaves it as it is.

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
- **BACKUP** is the backup app for the seated project, with the relay token's
  `operate` scope: the store, the last runs, the Drive setting, Snapshot now
  and its summary, a running lane's progress and Stop.
- **MACHINE** is the monitor row as seven tiles (CPU, MEM, TEMP, FAN, NET, PROC,
  BAT) with their live readings, polled every two seconds while the tab is in
  front. A tile opens the phone's machine sheet: the CPU sheet shows the cores,
  PROC the top twenty processes. Under the sheet one line reads the lock state.
- **BROWSER** is BAUD's own Chrome (see [the browser](browser.md)), read over
  IPC, not the relay, every five seconds while the tab is in front. Down, it
  says `BAUD's Chrome is not running` and offers `launch` and `adopt my
  Chrome`; running, it shows the port, the profile path and the native-hosts
  word, then a tab row of the open pages, each with `×`, and `+`, the `‹` back
  and `›` forward doors beside a URL bar, and the shown page live on a canvas
  that takes the mouse, the wheel and, while focused, the keys. On the phone the same card opens the same screen, which shows the
  host's `not_on_the_phone` refusal.

## What differs from the phone

- **Width.** The screens fill the workbench pane rather than a phone's column.
- **Tabs, not overlays.** Each app is a workbench tab beside the terminal and
  the other tabs; the tab's ✕ closes it from any depth, and each screen's own
  `‹` at its floor closes it too.
- **The lock line has no lock verb.** The desktop is the screen being locked, so
  MACHINE reads the lock state and offers nothing to set it.
- **Back words.** The screens keep the phone's own back words: the floors of
  GIT and BACKUP say `‹ wheel` and close the tab, and the machine sheet's
  `‹ wheel` returns to the tiles, whose own `‹ close` closes the tab.
