# The backup app

This page covers the backup app on the wheel's apps layer: what the store holds, the four presses, stop and progress, and which project it reads.

← [the phone face](../phone.md)

### The backup app — the store, and four presses that add to it

**The third card on the apps layer**, `BKP`, after `git` and `files` (DPLAN-0411).
A project's backup store belongs to nobody in it, which is why it sits on the
apps layer. The card carries no badge. Tapping it opens
`phone/backup/BackupApp.tsx` over the stage, for the **seated project** (the
header chip's name, the same value the git app gets); `‹ wheel` closes it.

**What the store holds**, read from `GET /v1/backup/status`: one line per lane,
*Snapshot · 2h ago · 15,414 files*, *Versioned · 18d ago · 4 files*,
*Drive · never*, using the face's own age words, plus the project's Drive sync
setting, on or off. **sizes** re-reads with `sizes=1` and adds the two store
sizes. It is a chip rather than part of every read, because walking a large
store takes seconds. These lines come from @backup reading its own store on disk,
so they survive a server restart that forgets every job.

**Four click options:** **Snapshot now**, **Versioned now**, **Full backup** and
**Sync to Drive**, which are the lanes `snapshot`, `versioned`, `all` and
`drive_sync`. Each press is `POST /v1/backup/run` and answers at once with a job.
While anything runs, the sheet reads `GET /v1/backup/status` every 2 s, while the
screen is looked at. When status no longer lists the press, the sheet reads
`GET /v1/backup/job` once for the outcome, shows the command's own last lines
verbatim, and re-reads the status. The other presses stay live while one runs,
since @backup decides what overlapping lanes mean. A sheet opened mid-run adopts
every run from status's `running` list.

**Stop and progress** (DPLAN-0412). The running list comes from @backup's own
running files, so it carries runs started from a terminal or by the daemon as
well as the phone's, each with its pressed `verb`, the `lane` at work and a
`progress` object.

- **A listed press reads Stop**, in the accent outline, with no confirm, because
  stopping is the safe direction. It POSTs `/v1/backup/cancel {project, lane}`
  with the pressed verb (`all` stops the whole cycle) and shows @backup's answer
  verbatim (`stopped drive_sync (pid 175450)`). A 404 `not_running` means the run
  ended between two reads, so status is read again. A read token is refused the
  Stop by name, as it is every run. A press the phone holds a job for that status
  does not list yet shows `· running…` and does not fire.
- **One progress block per running entry:** the press's name (under Full backup,
  the sub-lane at work with its counts: *Full backup · versioned · 300 / 15,491*);
  a bar, which is a real `<progress>` and is indeterminate while the lane scans;
  the line *1,204 / 15,414 files · 310 MB of 2.9 GB · 2m 10s* (bytes in @backup's
  own 1024-based words, *of …* only when the lane knows its planned bytes, elapsed
  from `started_at`), or *scanning…* while `progress` is null; and the tail of
  the file in flight in the mono face. The progress line ends with *· N failed*
  when the lane's `progress.failed` is above zero.
- **Stopped** is its own outcome word, in the dim colour rather than red, over
  the summary verbatim (*stopped by request: 1,204 of 15,414 files, 310 MB*).
  Done is green, failed red.
- **A run that refused before uploading anything** leads with its own sentence.
  When a failed job's summary ends in a line ending *Nothing uploaded.* (Drive
  headroom: *Drive has 1.4 GB free; this run needs 2.9 GB. Nothing uploaded.*),
  that line is the headline and only the lines above it stay in the block below.

**The two presses that can send files off the machine ask once:** Sync to Drive
always, and Full backup when the Drive setting is on (or not known). The confirm
is the kill verb's dialog shape and the face's manners only: the server is not
told a human confirmed, because it would not honour that. A read token sees the
status and is refused every press by name. The server's sentences (a 400
"already running", any 503) are shown as they came. A 404 for a job the server
forgot (it restarted) sends the reader to the status lines, which hold the run's
outcome.

**Which project, and what it holds.**

- **The head names the seat and shows its root.** The title is the seated
  project's name, and once a status answer has landed, the line under it is the
  answer's `root`. @api echoes the asked `project` verbatim, so `backupHead`
  shows a root only from an answer whose `project` is this seat. The sheet is
  keyed on the seat as well, so a header project switch starts again from the
  name alone and the old seat's path is never shown under the new name.
- **No project seated** says *no project is seated yet* in the status block,
  instead of *reading the store…* with nothing to read.
- **A root with no `.backup/` store** (`registered: false`) leads the status
  block with *this project has no backup store yet — register it with drone
  @backup register <root>*. The lane lines read *never*, and the presses stay
  live because @backup decides what a press on an unregistered root does.
- **A run started elsewhere shows up.** While no run is in flight, the sheet
  reads status every 10 s, through `whileVisible`, so a closed sheet or a
  pocketed phone reads nothing; `whileVisible` ticks at once, which is the read
  on open. Once status lists a run, the 2 s watch takes over. One tick runs at a
  time across both.

**The desktop does not have it.** `transport.ts` refuses `backup_run`,
`backup_job`, `backup_status` and `backup_cancel` by name, because the desktop
sits beside `drone @backup` in its own terminal. Every wire shape is pinned in
one place, `src/aipass/devpulse/docs.local/backup_door_contract.md` in the AIPass tree.
`types.ts` mirrors it field for field.
