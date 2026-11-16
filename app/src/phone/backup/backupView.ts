/** The backup sheet's words and rules, pure so they test without a server. Reference: docs/phone/backup.md */

import { relativeAge } from "../../age";
import type {
  BackupFrequency,
  BackupJob,
  BackupLane,
  BackupLaneStatus,
  BackupProgress,
  BackupRunning,
  BackupSchedule,
  BackupScheduleWrite,
  BackupStatus,
  BackupWeekday,
} from "../../types";

export const BACKUP_BUTTONS: ReadonlyArray<{ lane: BackupLane; label: string }> = [
  { lane: "snapshot", label: "Snapshot now" },
  { lane: "drive_sync", label: "Sync to Drive" },
  { lane: "all", label: "Back up all now" },
];

/** A run's name where it differs from its press: a running all reads "Back up all", scheduled or pressed. */
const RUN_LABELS: Partial<Record<BackupLane, string>> = { all: "Back up all" };

/** A verb status lists that has no press still shows, as its Stop. */
export function shownButtons(active: readonly BackupLane[]): Array<{ lane: BackupLane; label: string }> {
  const extra = [...new Set(active)].filter((verb) => !BACKUP_BUTTONS.some((button) => button.lane === verb));
  return [...BACKUP_BUTTONS, ...extra.map((lane) => ({ lane, label: verbLabel(lane) }))];
}

/** `all` has no status line: it runs the other lanes, and each of them keeps its date. */
export const STATUS_LANES: ReadonlyArray<{ key: "snapshot" | "drive_sync"; label: string }> = [
  { key: "snapshot", label: "Snapshot" },
  { key: "drive_sync", label: "Drive" },
];

/** One status line: "Snapshot · 2h ago · 15,414 files", "Drive · never". */
export function laneLine(label: string, lane: BackupLaneStatus | undefined, now: number = Date.now()): string {
  if (!lane?.last) return `${label} · never`;
  const age = relativeAge(lane.last, now).label;
  return lane.files === null ? `${label} · ${age}` : `${label} · ${age} · ${lane.files.toLocaleString("en-US")} files`;
}

export function driveLine(status: BackupStatus): string {
  return `Drive sync setting · ${status.drive_sync ? "on" : "off"}`;
}

/** Unknown counts as on: a press must never send files off the machine unasked. */
export function driveSyncOn(
  status: Pick<BackupStatus, "drive_sync"> | null,
  schedule: Pick<BackupSchedule, "steps"> | null,
): boolean {
  if (!status && !schedule) return true;
  return status?.drive_sync === true || (schedule?.steps ?? []).includes("drive_sync");
}

export function leavesMachine(lane: BackupLane, driveOn = false): boolean {
  return lane === "drive_sync" || (lane === "all" && driveOn);
}

export function confirmLine(project: string, lane: BackupLane = "drive_sync"): string {
  return lane === "all"
    ? `Snapshot ${project}, then sync its backups to Google Drive?`
    : `Sync ${project}'s backups to Google Drive?`;
}

export const FREQUENCIES: ReadonlyArray<{ value: BackupFrequency; label: string }> = [
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

export const WEEKDAYS: readonly BackupWeekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const twoDigits = (count: number) => Array.from({ length: count }, (_, n) => String(n).padStart(2, "0"));
export const HOURS = twoDigits(24);
export const MINUTES = twoDigits(60);
export const MONTH_DAYS = Array.from({ length: 31 }, (_, n) => n + 1);

export const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** "Every day at 05:00", "Every Monday at 05:00", "Every month on day 31 at 05:00"; null with no schedule. */
export function whenLine(schedule: Pick<BackupSchedule, "frequency" | "time" | "weekday" | "day">): string | null {
  const { frequency, time, weekday, day } = schedule;
  if (!frequency || !time) return null;
  if (frequency === "weekly") return `Every ${weekday ? capital(weekday) : "week"} at ${time}`;
  if (frequency === "monthly") return day ? `Every month on day ${day} at ${time}` : `Every month at ${time}`;
  return `Every day at ${time}`;
}

const STEP_WORDS: Record<string, string> = { snapshot: "Snapshot", drive_sync: "Drive sync" };

/** What a run does, in the server's order: "Snapshot, then Drive sync", "Snapshot only". */
export function stepsLine(steps: readonly string[]): string {
  const words = steps.map((step) => STEP_WORDS[step] ?? step);
  return words.length === 1 ? `${words[0]} only` : words.join(", then ");
}

export function lastRunLine(
  schedule: Pick<BackupSchedule, "last_run" | "last_status" | "last_error">,
  now: number = Date.now(),
): string {
  if (!schedule.last_run) return "Last run · never";
  const parts = ["Last run", relativeAge(schedule.last_run, now).label];
  if (schedule.last_status && schedule.last_status !== "success") parts.push(schedule.last_status);
  if (schedule.last_error) parts.push(schedule.last_error);
  return parts.join(" · ");
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Next run · Mon 16 Nov at 05:00", read off the naive local stamp as written; off says so and names no run. */
export function nextRunLine(schedule: Pick<BackupSchedule, "on" | "next_run">): string {
  if (!schedule.on) return "Off · no run until it is switched on";
  if (!schedule.next_run) return "Next run · not known";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(schedule.next_run);
  if (!match) return `Next run · ${schedule.next_run}`;
  const [, year, month, day, hour, minute] = match;
  const weekday = DAY_NAMES[new Date(Number(year), Number(month) - 1, Number(day)).getDay()];
  return `Next run · ${weekday} ${Number(day)} ${MONTH_NAMES[Number(month) - 1]} at ${hour}:${minute}`;
}

export interface ScheduleEdit {
  frequency: BackupFrequency;
  weekday: BackupWeekday;
  day: number;
  time: string;
}

export function scheduleEdit(schedule: BackupSchedule | null): ScheduleEdit {
  return {
    frequency: schedule?.frequency ?? "daily",
    weekday: schedule?.weekday ?? "monday",
    day: schedule?.day ?? 1,
    time: schedule?.time ?? "05:00",
  };
}

export function editProblem(edit: ScheduleEdit): string | null {
  if (!FREQUENCIES.some((choice) => choice.value === edit.frequency)) return "pick how often it runs";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(edit.time)) return "the time must be HH:MM, 24-hour";
  if (edit.frequency === "weekly" && !WEEKDAYS.includes(edit.weekday)) return "pick a weekday";
  if (edit.frequency === "monthly" && !(Number.isInteger(edit.day) && edit.day >= 1 && edit.day <= 31)) {
    return "the day must be 1 to 31";
  }
  return null;
}

/** Only the fields the frequency takes: the server refuses the rest. */
export function scheduleBody(project: string, edit: ScheduleEdit): BackupScheduleWrite {
  const body: BackupScheduleWrite = { project, frequency: edit.frequency, time: edit.time };
  if (edit.frequency === "weekly") body.weekday = edit.weekday;
  if (edit.frequency === "monthly") body.day = edit.day;
  return body;
}

export const NO_PROJECT = "no project is seated yet";

export interface BackupHead {
  name: string;
  path: string | null;
}

/** @api echoes the asked project verbatim, so a mismatch is an answer for another seat. */
export function backupHead(project: string, status: Pick<BackupStatus, "project" | "root"> | null): BackupHead {
  if (!project) return { name: "no project", path: null };
  return { name: project, path: status?.project === project && status.root ? status.root : null };
}

export function unregisteredLine(root: string): string {
  return `this project has no backup store yet — register it with drone @backup register ${root}`;
}

export const JOB_FORGOTTEN =
  "the server restarted and forgot this run - its outcome is in the status lines above now";

/** verb -> job id from status's `running`, so a sheet opened mid-run reads the outcome. Keyed on
 *  `verb`, never `lane`: under `all` the lane changes while the job stays the one the nightly run started. */
export function runningJobs(status: Pick<BackupStatus, "running"> | null): Partial<Record<BackupLane, string>> {
  const jobs: Partial<Record<BackupLane, string>> = {};
  for (const entry of status?.running ?? []) {
    if (entry.job && !jobs[entry.verb]) jobs[entry.verb] = entry.job;
  }
  return jobs;
}

export function runningVerbs(status: Pick<BackupStatus, "running"> | null): BackupLane[] {
  const verbs: BackupLane[] = [];
  for (const entry of status?.running ?? []) {
    if (!verbs.includes(entry.verb)) verbs.push(entry.verb);
  }
  return verbs;
}

export type ButtonPhase = "idle" | "watched" | "stop" | "stopping";

/** `watched`: the phone holds a job status does not list yet (no running file, or `all` between sub-lanes). */
export function buttonPhase(
  verb: BackupLane,
  listed: readonly BackupLane[],
  watched: boolean,
  stopping: boolean,
): ButtonPhase {
  if (stopping) return "stopping";
  if (listed.includes(verb)) return "stop";
  if (watched) return "watched";
  return "idle";
}

export function buttonWord(label: string, phase: ButtonPhase): string {
  switch (phase) {
    case "stop":
      return "Stop";
    case "stopping":
      return "Stopping…";
    case "watched":
      return `${label} · running…`;
    default:
      return label;
  }
}

/** A button's name for a screen reader: every shown button can read Stop at once. */
export function buttonName(label: string, phase: ButtonPhase): string {
  return phase === "stop" || phase === "stopping" ? `stop ${label}` : label;
}

export function verbLabel(verb: BackupLane): string {
  return RUN_LABELS[verb] ?? BACKUP_BUTTONS.find((button) => button.lane === verb)?.label ?? verb;
}

/** 1024-based, as @backup's `_human_bytes`, so the bar and the stopped summary name a size alike. */
export function backupBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function durationText(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function elapsedSeconds(startedAt: string, now: number): number | null {
  const start = Date.parse(startedAt);
  return Number.isNaN(start) ? null : Math.max(0, (now - start) / 1000);
}

/** "45s", "2m 10s", "1h 5m"; null for an unparseable instant, 0s for a clock behind the server's. */
export function elapsedText(startedAt: string, now: number = Date.now()): string | null {
  const seconds = elapsedSeconds(startedAt, now);
  return seconds === null ? null : durationText(Math.floor(seconds));
}

/** "25m 34s left": the time so far scaled by the files still to go. Null before the first file lands or without a start. */
export function remainingText(entry: Pick<BackupRunning, "started_at" | "progress">, now: number = Date.now()): string | null {
  const progress = entry.progress;
  const seconds = elapsedSeconds(entry.started_at, now);
  if (!progress || progress.done <= 0 || seconds === null) return null;
  const left = Math.max(0, progress.total - progress.done);
  return `${durationText(Math.round((seconds * left) / progress.done))} left`;
}

export function barFraction(progress: BackupProgress | null): number | null {
  if (!progress) return null;
  if (progress.total <= 0) return 0;
  return Math.min(1, Math.max(0, progress.done / progress.total));
}

const count = (n: number) => n.toLocaleString("en-US");

/** Under `all` the head names the sub-lane and its counts: the bar restarts per sub-lane and would seem to go back. */
export function progressHead(entry: Pick<BackupRunning, "verb" | "lane" | "progress">): string {
  const label = verbLabel(entry.verb);
  if (entry.verb !== "all") return label;
  const head = `${label} · ${entry.lane}`;
  return entry.progress ? `${head} · ${count(entry.progress.done)} / ${count(entry.progress.total)}` : head;
}

/** "1,204 / 15,414 files · 310 MB of 2.9 GB · 25m 34s left", or "scanning…" before the lane has a total. */
export function progressLine(entry: Pick<BackupRunning, "started_at" | "progress">, now: number = Date.now()): string {
  const progress = entry.progress;
  if (!progress) return "scanning…";
  const bytes =
    progress.bytes_total === null
      ? backupBytes(progress.bytes_done)
      : `${backupBytes(progress.bytes_done)} of ${backupBytes(progress.bytes_total)}`;
  const parts = [`${count(progress.done)} / ${count(progress.total)} files`, bytes];
  const time = remainingText(entry, now) ?? elapsedText(entry.started_at, now);
  if (time) parts.push(time);
  if (progress.failed > 0) parts.push(`${count(progress.failed)} failed`);
  return parts.join(" · ");
}

export const CURRENT_TAIL = 48;

/** A long path keeps its end, the part that changes per file, cut at a folder so no name shows half. */
export function currentTail(current: string | null, max: number = CURRENT_TAIL): string | null {
  if (!current) return null;
  if (current.length <= max) return current;
  const tail = current.slice(current.length - (max - 1));
  const slash = tail.indexOf("/");
  return `…${slash >= 0 && slash < tail.length - 1 ? tail.slice(slash) : tail}`;
}

/** What @backup's Drive headroom refusal ends in, verbatim. */
export const NOTHING_UPLOADED = "Nothing uploaded.";

export interface OutcomeView {
  tone: BackupJob["state"] | "forgotten";
  head: string;
  body: string;
}

/** A failure whose last line ends "Nothing uploaded." refused before uploading: that line is the headline. */
export function outcomeView(label: string, state: BackupJob["state"] | "forgotten", text: string): OutcomeView {
  if (state === "failed") {
    const lines = text.split("\n").map((line) => line.trimEnd());
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    const last = lines[lines.length - 1]?.trim() ?? "";
    if (last.endsWith(NOTHING_UPLOADED)) {
      return { tone: state, head: `${label} · ${last}`, body: lines.slice(0, -1).join("\n").trimEnd() };
    }
  }
  return { tone: state, head: `${label} · ${state}`, body: text };
}
