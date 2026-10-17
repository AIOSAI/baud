/**
 * The backup sheet's words and rules, pure (DPLAN-0411; the owner, 2026-10-16:
 * "in the apps wheel in baud id like backup in there, i open the card and i see
 * my click options, i can backup from baud").
 *
 * Every wire shape is @backup's and @api's, pinned in
 * devpulse/docs.local/backup_door_contract.md; `types.ts` carries them field
 * for field. This file decides only what the sheet SAYS about them and which
 * press has to ask first, so that both can be tested without a server.
 */

import { relativeAge } from "../../age";
import type { BackupJob, BackupLane, BackupLaneStatus, BackupProgress, BackupRunning, BackupStatus } from "../../types";

/** The four click options, in the owner's words, in the order he said them. */
export const BACKUP_BUTTONS: ReadonlyArray<{ lane: BackupLane; label: string }> = [
  { lane: "snapshot", label: "Snapshot now" },
  { lane: "versioned", label: "Versioned now" },
  { lane: "all", label: "Full backup" },
  { lane: "drive_sync", label: "Sync to Drive" },
];

/** The status block's lines, in the contract's order. `all` has no line of its
 *  own: it is the other lanes run together, and each of them keeps its date. */
export const STATUS_LANES: ReadonlyArray<{ key: "snapshot" | "versioned" | "drive_sync"; label: string }> = [
  { key: "snapshot", label: "Snapshot" },
  { key: "versioned", label: "Versioned" },
  { key: "drive_sync", label: "Drive" },
];

/**
 * One status line: "Snapshot · 2h ago · 15,414 files", "Drive · never".
 *
 * Args:
 *   label: The lane's name on the sheet.
 *   lane: The lane's entry, or undefined when the answer carried none.
 *   now: The clock, for the age.
 */
export function laneLine(label: string, lane: BackupLaneStatus | undefined, now: number = Date.now()): string {
  if (!lane?.last) return `${label} · never`;
  const age = relativeAge(lane.last, now).label;
  return lane.files === null ? `${label} · ${age}` : `${label} · ${age} · ${lane.files.toLocaleString("en-US")} files`;
}

/** The Drive setting's line. */
export function driveLine(status: BackupStatus): string {
  return `Drive sync setting · ${status.drive_sync ? "on" : "off"}`;
}

/**
 * Whether a press can send files off this machine, so has to ask first.
 *
 * `drive_sync` always does. `all` does when the project's Drive setting is on,
 * and when that setting is not known yet the answer is yes: asking once too
 * often is a tap, while not asking is a publish nobody meant.
 *
 * Args:
 *   lane: The lane pressed.
 *   driveSyncOn: The project's setting, or null before status has answered.
 */
export function leavesMachine(lane: BackupLane, driveSyncOn: boolean | null): boolean {
  if (lane === "drive_sync") return true;
  if (lane === "all") return driveSyncOn !== false;
  return false;
}

/** The question the confirm dialog asks. */
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

/** What the sheet says when a job id was forgotten by a restarted server. */
export const JOB_FORGOTTEN =
  "the server restarted and forgot this run - its outcome is in the status lines above now";

/**
 * The jobs to read for an outcome, from status's `running` list, so a sheet
 * opened mid-run keeps the run's job and reads it once the run ends.
 *
 * Keyed on `verb`, the press, never on `lane`: under `all` the lane changes
 * from sub-lane to sub-lane while the job stays the one Full backup started.
 * An entry with no job (a run from a terminal or the daemon) is skipped: there
 * is nothing on this server to read for it, and the status lines carry its end.
 *
 * Returns:
 *   verb -> job id, first entry per verb.
 */
export function runningJobs(status: Pick<BackupStatus, "running"> | null): Partial<Record<BackupLane, string>> {
  const jobs: Partial<Record<BackupLane, string>> = {};
  for (const entry of status?.running ?? []) {
    if (entry.job && !jobs[entry.verb]) jobs[entry.verb] = entry.job;
  }
  return jobs;
}

/* ------------------------------------------------- round 2 (DPLAN-0412) -- */
/* The owner, 2026-10-16 06:50: "ive no way to stop it. once it starts. some
   info would be nice, like a status bar with progress too." */

/** The verbs status lists as running, each once, in the order listed. */
export function runningVerbs(status: Pick<BackupStatus, "running"> | null): BackupLane[] {
  const verbs: BackupLane[] = [];
  for (const entry of status?.running ?? []) {
    if (!verbs.includes(entry.verb)) verbs.push(entry.verb);
  }
  return verbs;
}

/** The four states of a press's button; `buttonPhase` says which is which. */
export type ButtonPhase = "idle" | "watched" | "stop" | "stopping";

/**
 * What one press's button is right now.
 *
 * - `stop`: status lists its verb, so there is a run to end and the button
 *   ends it. Whoever started the run: a terminal's run stops the same way.
 * - `stopping`: a stop is on its way and has not answered yet.
 * - `watched`: the phone holds a job for it that status does not list yet (the
 *   lane has not written its running file, or `all` is between sub-lanes). Not
 *   re-pressable, and nothing to stop yet.
 * - `idle`: a press starts a run.
 *
 * Args:
 *   verb: The press.
 *   listed: The verbs status lists as running.
 *   watched: Whether the phone holds a job for this verb.
 *   stopping: Whether a stop for this verb is in flight.
 */
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

/** The words on a press's button, by phase. */
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

/** A press's label by its verb, the lane name itself when it is not a press. */
export function verbLabel(verb: BackupLane): string {
  return BACKUP_BUTTONS.find((button) => button.lane === verb)?.label ?? verb;
}

/**
 * Bytes in the words @backup's own lines use ("310 MB", "2.9 GB"): 1024-based,
 * as its `_human_bytes` counts, so the bar and the stopped summary beneath it
 * name the same number the same way.
 */
export function backupBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * Time since a run started: "45s", "2m 10s", "1h 5m". Null when the instant
 * does not parse, so the line drops the piece rather than saying "NaN". A clock
 * behind the server's reads as 0s, never as a negative.
 */
export function elapsedText(startedAt: string, now: number = Date.now()): string | null {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * How full the bar is, 0 to 1, or null while the lane is scanning (the bar is
 * then the platform's own indeterminate one). A total of zero is a run with
 * nothing to do, so it reads empty rather than dividing by it.
 */
export function barFraction(progress: BackupProgress | null): number | null {
  if (!progress) return null;
  if (progress.total <= 0) return 0;
  return Math.min(1, Math.max(0, progress.done / progress.total));
}

const count = (n: number) => n.toLocaleString("en-US");

/**
 * The progress block's head: the press, and under `all` the sub-lane at work
 * with its counts ("Full backup · versioned · 300 / 15,491"), because Full
 * backup's bar restarts at each sub-lane and would otherwise seem to go back.
 */
export function progressHead(entry: Pick<BackupRunning, "verb" | "lane" | "progress">): string {
  const label = verbLabel(entry.verb);
  if (entry.verb !== "all") return label;
  const head = `${label} · ${entry.lane}`;
  return entry.progress ? `${head} · ${count(entry.progress.done)} / ${count(entry.progress.total)}` : head;
}

/**
 * The progress line: "1,204 / 15,414 files · 310 MB of 2.9 GB · 2m 10s".
 * "of …" only when the lane knows its planned bytes; "scanning…" before the
 * lane has a total, which is when it writes `progress: null`.
 */
export function progressLine(entry: Pick<BackupRunning, "started_at" | "progress">, now: number = Date.now()): string {
  const progress = entry.progress;
  if (!progress) return "scanning…";
  const bytes =
    progress.bytes_total === null
      ? backupBytes(progress.bytes_done)
      : `${backupBytes(progress.bytes_done)} of ${backupBytes(progress.bytes_total)}`;
  const parts = [`${count(progress.done)} / ${count(progress.total)} files`, bytes];
  const elapsed = elapsedText(entry.started_at, now);
  if (elapsed) parts.push(elapsed);
  if (progress.failed > 0) parts.push(`${count(progress.failed)} failed`);
  return parts.join(" · ");
}

/** How much of the file in flight's path fits the line. */
export const CURRENT_TAIL = 48;

/**
 * The tail of the file in flight. A long path keeps its END, which is the part
 * that changes from file to file, cut at a folder boundary when one falls in
 * the tail so no name is shown half. Null before the first file.
 */
export function currentTail(current: string | null, max: number = CURRENT_TAIL): string | null {
  if (!current) return null;
  if (current.length <= max) return current;
  const tail = current.slice(current.length - (max - 1));
  const slash = tail.indexOf("/");
  return `…${slash >= 0 && slash < tail.length - 1 ? tail.slice(slash) : tail}`;
}

/** What the Drive headroom refusal's sentence ends in (contract, round 2). */
export const NOTHING_UPLOADED = "Nothing uploaded.";

/** How a run ended, as the sheet draws it. */
export interface OutcomeView {
  /** The class suffix: done green, failed red, stopped and forgotten dim. */
  tone: BackupJob["state"] | "forgotten";
  head: string;
  /** What goes in the raw block beneath, verbatim; empty for none. */
  body: string;
}

/**
 * The outcome's headline and body.
 *
 * Today's rendering is "Sync to Drive · failed" over the command's last lines.
 * A run that refused before uploading anything (Drive headroom, or a quota it
 * could not read) says so in its summary's last line, which ends in "Nothing
 * uploaded.": that sentence IS the outcome, so it becomes the headline and only
 * the lines above it stay in the block. The sentence is @backup's, verbatim.
 *
 * Args:
 *   label: The press's label.
 *   state: The job's end, or forgotten for a job a restarted server lost.
 *   text: The summary (or error), verbatim.
 */
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
