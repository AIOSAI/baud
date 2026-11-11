/** The backup sheet's words and rules, pure so they test without a server. Reference: docs/phone/backup.md */

import { relativeAge } from "../../age";
import type { BackupJob, BackupLane, BackupLaneStatus, BackupProgress, BackupRunning, BackupStatus } from "../../types";

export const BACKUP_BUTTONS: ReadonlyArray<{ lane: BackupLane; label: string }> = [
  { lane: "snapshot", label: "Snapshot now" },
  { lane: "versioned", label: "Versioned now" },
  { lane: "all", label: "Full backup" },
  { lane: "drive_sync", label: "Sync to Drive" },
];

/** `all` has no status line: it runs the other lanes, and each of them keeps its date. */
export const STATUS_LANES: ReadonlyArray<{ key: "snapshot" | "versioned" | "drive_sync"; label: string }> = [
  { key: "snapshot", label: "Snapshot" },
  { key: "versioned", label: "Versioned" },
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

/** An unknown Drive setting asks: asking once too often is a tap, not asking is a publish nobody meant. */
export function leavesMachine(lane: BackupLane, driveSyncOn: boolean | null): boolean {
  if (lane === "drive_sync") return true;
  if (lane === "all") return driveSyncOn !== false;
  return false;
}

export function confirmLine(lane: BackupLane, project: string): string {
  return lane === "drive_sync"
    ? `Sync ${project}'s backups to Google Drive?`
    : `Run a full backup of ${project}, including its Drive sync?`;
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
 *  `verb`, never `lane`: under `all` the lane changes while the job stays the one Full backup started. */
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

/** A button's name for a screen reader: four buttons can all read Stop. */
export function buttonName(label: string, phase: ButtonPhase): string {
  return phase === "stop" || phase === "stopping" ? `stop ${label}` : label;
}

export function verbLabel(verb: BackupLane): string {
  return BACKUP_BUTTONS.find((button) => button.lane === verb)?.label ?? verb;
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
