# The backup app

This page covers the backup app on the wheel's apps layer: the scheduled backup, what the store holds, the three presses, stop and progress, and which project it reads.

← [the phone face](../phone.md)

### The backup app — the schedule, the store, and three presses that add to it

**The third card on the apps layer**, `BKP`, after `git` and `files`.
A project's backup store belongs to nobody in it, which is why it sits on the
apps layer. The card carries no badge. Tapping it opens
`phone/backup/BackupApp.tsx` over the stage, for the **seated project** (the
header chip's name, the same value the git app gets); `‹ wheel` closes it.

**Scheduled backup** heads the card, read from `GET /v1/backup/schedule` on
open and again when a run ends. Each project has its own schedule and its own
on/off; the card shows the seated project's.

- **The title row** carries the house switch (on/off) once a schedule exists.
- **When it runs**, in plain words: *Every day at 05:00*, *Every Monday at
  05:00*, *Every month on day 31 at 05:00*.
- **What a run does**, in order, rendered from the answer's `steps`:
  `["snapshot","drive_sync"]` reads *Snapshot, then Drive sync*; `["snapshot"]`
  (the project's Drive sync is off) reads *Snapshot only*. Drive sync uploads
  the snapshot, so the snapshot runs first.
- **Last run**: *Last run · 4h ago*, with the status when it is not `success`
  and `last_error` when present (*Last run · 1d ago · failed · …*); *Last run ·
  never* before a first run.
- **Next run** while on, read off the naive local stamp as written: *Next run ·
  Mon 16 Nov at 05:00*. While off it reads *Off · no run until it is switched
  on* and names no run.
- **change** opens the editor: *how often* (Every day, Every week, Every month),
  a weekday for weekly, a day 1–31 for monthly (past a month's end, it runs on
  that month's last day), and the time as hour and minute, 24-hour. **save**
  sends one `POST /v1/backup/schedule` with only the fields the frequency takes;
  the switch sends `{project, on}` alone. The answer is the schedule read back.
- **A project with no schedule** (`scheduled: false`) reads *No scheduled
  backup*, shows its steps, and opens the editor at once to create one. A new
  schedule starts off, so the switch reads off until pressed.
- The editor refuses a time that is not `HH:MM` before sending. A server refusal
  (400 `verb_refused`, such as switching on before a schedule exists) and a 503
  show as their sentence under the section, as the presses' do. A read token is
  refused every write by name.

**What the store holds**, read from `GET /v1/backup/status`: one line per lane,
*Snapshot · 2h ago · 15,414 files*, *Drive · never*, using the face's own age
words, plus the project's Drive sync setting, on or off. **sizes** re-reads with
`sizes=1` and adds the snapshots' store size. It is a chip rather than part of every read, because walking a large
store takes seconds. These lines come from @backup reading its own store on disk,
so they survive a server restart that forgets every job.

**Three click options:** **Snapshot now**, **Sync to Drive** and **Back up all
now**, which are the lanes `snapshot`, `drive_sync` and `all`. `all` runs the
snapshot, then Drive sync when the project has Drive sync on, otherwise the
snapshot only. A running `all`, pressed or started by the schedule, shows as
**Back up all** with its sub-lane and its Stop. A verb status lists that has no
press still shows, as its Stop. Each press is `POST /v1/backup/run` and answers at once with a job.
While anything runs, the sheet reads `GET /v1/backup/status` every 2 s, while the
screen is looked at. When status no longer lists the press, the sheet reads
`GET /v1/backup/job` once for the outcome, shows the command's own last lines
verbatim, and re-reads the status. The other presses stay live while one runs,
since @backup decides what overlapping lanes mean. A sheet opened mid-run adopts
every run from status's `running` list.

**Stop and progress.** The running list comes from @backup's own
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
- **One progress block per running entry:** the press's name (under a running `all`, *Back up all* and
  the sub-lane at work with its counts: *Back up all · snapshot · 300 / 15,491*);
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

**A press that sends files off the machine asks once:** Sync to Drive, always,
whatever the Drive setting says (*Sync baud's backups to Google Drive?*); Back
up all only when Drive sync is on for the project, by status's `drive_sync` or
the schedule's `steps` (*Snapshot baud, then sync its backups to Google
Drive?*). Before either answer lands, Back up all asks too. The confirm
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

**The desktop opens the same card** (`desktop/AppScreens.tsx`); none of the
backup verbs is a Rust command, so `route.ts` sends them over the relay.

### The wire

Six routes on the host API, with the same token rules as the rest of the phone's
surface. `types.ts` holds them as `BackupStatus`, `BackupRunning`,
`BackupProgress`, `BackupJob`, `BackupCancel`, `BackupSchedule` and
`BackupScheduleWrite`, and `transport.http.ts` maps the verbs `backup_run`,
`backup_job`, `backup_status`, `backup_cancel`, `backup_schedule` and
`backup_schedule_set` onto them.
The lane is always one of the three drone verb names: `snapshot`, `all`,
`drive_sync`.

| route | scope | sends | answers |
| --- | --- | --- | --- |
| `POST /v1/backup/run` | operate | body `{project, lane}` | **202**, a job with `state: "running"` |
| `GET /v1/backup/job?id=` | read | the job id | the job |
| `GET /v1/backup/status?project=[&sizes=1]` | read | the seat, and `sizes=1` only when asked | the status |
| `POST /v1/backup/cancel` | operate | body `{project, lane}`, the pressed verb | **200**, `{project, lane, stopped, message}` |
| `GET /v1/backup/schedule?project=` | read | the seat | the schedule |
| `POST /v1/backup/schedule` | operate | body `{project, frequency?, time?, weekday?, day?, on?}` | **200**, the schedule read back |

- **A schedule** is `{project, root, job_id, scheduled, on, frequency, time,
  weekday, day, steps, last_run, last_status, last_error, next_run}`.
  `frequency` is `daily`, `weekly` or `monthly`; `time` is `HH:MM`, 24-hour;
  `weekday` (`monday`…`sunday`) is set only for weekly and `day` (1–31) only for
  monthly. `steps` is `["snapshot"]` or `["snapshot","drive_sync"]`. `next_run`
  is a naive local `YYYY-MM-DDTHH:MM:SS`, null while off. `scheduled: false`
  means no job: `on` false, `frequency`, `time` and `next_run` null.
- **A schedule write** sends `{frequency: "daily", time}`, `{frequency:
  "weekly", weekday, time}` or `{frequency: "monthly", day, time}` with `day` a
  JSON integer, and `on` a JSON boolean, alone or beside them. A field the
  frequency does not take is refused. The write is not atomic: the answer is the
  schedule as it now reads.

- **Status** is @backup's own `status --json`, passed through: `project`, `root`,
  `registered`, `mode`, `drive_sync` (the setting), `runs`, `lanes` with
  `{last, files}` for `snapshot` and `{last, files, complete}` for `drive_sync`
  (`last` and `files` null when the lane never ran), `drive.tracked_files`, and
  `store` with `snapshots_bytes`, present only under `sizes=1`. An unregistered root answers
  `registered: false`, every `last` null and `runs` 0, which is not an error.
- **Running** is a list on the status, `[]` when idle. Each entry has `job` (this
  server's id when it started the run, `null` for a terminal or daemon run),
  `verb`, `lane`, `pid`, `started_at` and `progress`. `progress` is `null` while
  the lane scans. Otherwise it holds `done`, `total` and `failed` file counts,
  `bytes_done`, `bytes_total` (`null` when the lane does not know it), `current`
  (`null` before the first file) and `updated_at`.
- **A job** has `job`, `project`, `lane`, `state` and `started_at`. Once it ends it
  also has `finished_at`, `exit`, `summary` (the command's last lines verbatim, at
  most about 600 characters) and `error`. `state` is `running`, `done` (exit 0),
  `stopped` (exit 130, the lane ending on a stop request) or `failed` (any other
  exit, a timeout, or a routing error mid-run). The server keeps finished jobs
  for an hour, in memory only.
- **The errors the sheet handles:** **400 `verb_refused`** for an unknown project,
  a lane outside the three, a run already in flight for that project and lane
  (*"<lane> already running for <project> since <iso>"*), or a schedule write the
  server refuses (switching on before a schedule exists). **404 `job_unknown`**
  for a job the server forgot, which sends the sheet to the status. **404
  `not_running`** from cancel when nothing of that lane runs. **503
  `verb_unavailable`** when @backup cannot be reached or is too old to answer
  `status --json`. A run that went ahead and failed is not an HTTP error: it is a
  `failed` job, read with a 200, with its sentence in `summary` or `error`.

@backup's side of the store and the Drive lane is in its own tracked docs,
`src/aipass/backup/docs/` in the AIPass repo.
