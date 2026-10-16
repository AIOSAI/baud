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
import type { BackupLane, BackupLaneStatus, BackupStatus } from "../../types";

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

/** What the sheet says when a job id was forgotten by a restarted server. */
export const JOB_FORGOTTEN =
  "the server restarted and forgot this run - its outcome is in the status lines above now";

/**
 * The lanes already running, from status's `running` list, so a sheet opened
 * mid-run shows that button running and keeps watching the job.
 *
 * Returns:
 *   lane -> job id, first entry per lane.
 */
export function runningJobs(status: Pick<BackupStatus, "running"> | null): Partial<Record<BackupLane, string>> {
  const jobs: Partial<Record<BackupLane, string>> = {};
  for (const entry of status?.running ?? []) {
    if (!jobs[entry.lane]) jobs[entry.lane] = entry.job;
  }
  return jobs;
}
