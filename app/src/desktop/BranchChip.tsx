import { useEffect, useState } from "react";
import { gitChanges } from "../host";

import { relativeAge } from "../age";
import { helpCommand } from "./InquiryPane";
import type { BranchStatus, GitChanges } from "../types";
import type { PhoneView } from "./phoneView";

export type LaunchMode = "resume" | "fresh";

/** Git polls slower than the dashboard: a subprocess per card per tick is
 *  real work, and uncommitted-file counts don't move second to second. */
export const GIT_POLL_MS = 15_000;

interface BranchChipProps {
  branch: BranchStatus;
  /** Operator clicked launch: open a claude session in this branch. */
  onLaunch: (branch: BranchStatus, mode: LaunchMode) => void;
  /** Operator clicked files: open this branch's directory tree. */
  onFiles: (branch: BranchStatus) => void;
  /** Operator clicked a figure or the summary: open the file behind it. */
  onOpenFile: (path: string, name: string, branch: string) => void;
  /** Operator clicked the changes badge: open this branch's diff tab. */
  onOpenDiff: (branch: BranchStatus) => void;
  /** Operator clicked the terminal glyph: open a plain shell in this branch. */
  onShell: (branch: BranchStatus) => void;
  /** A roster card from an unseated project: fenced doors (files, diff, figures, settings) would refuse, so they are withdrawn. */
  foreign: boolean;
  /** Operator clicked watch: open this branch's scoped monitor pane. */
  onMonitor: (branch: BranchStatus) => void;
  /** Operator clicked ?: open a help terminal seated in this branch. */
  onHelp: (branch: BranchStatus) => void;
  /** Operator clicked the gear: open this branch's settings panel. */
  onSettings: (branch: BranchStatus) => void;
  /** Operator clicked the avatar: open this agent's passport. Not the whole card, which would turn every miss into a navigation. */
  onOpenPassport: (branch: BranchStatus) => void;
  /** Opens or fronts a phone-screen tab for one of this card's designed reads. */
  onOpenPhone: (view: PhoneView) => void;
  /** Render the card as a report with no doors, for a face that can read but not act (the phone).
   *  Remote-capable verbs, when they come, return through the buttons this flag suppresses. */
  readOnly?: boolean;
}

/**
 * One branch's card on the fleet strip: lamp, badges, figures and doors.
 * Reference: docs/desktop/window-and-cards.md
 */
export default function BranchChip({
  branch,
  onLaunch,
  onFiles,
  onOpenFile,
  onOpenDiff,
  onMonitor,
  onShell,
  onHelp,
  onSettings,
  onOpenPassport,
  foreign,
  readOnly = false,
}: BranchChipProps) {
  const age = relativeAge(branch.last_updated);

  const [changes, setChanges] = useState<GitChanges | null>(null);
  useEffect(() => {
    // A foreign path always fails the fence, and a read-only face has no local git.
    if (foreign || readOnly) return;
    let mounted = true;
    const refresh = () => {
      gitChanges(branch.path)
        .then((next) => {
          if (mounted) setChanges(next);
        })
        .catch(() => {
          if (mounted) setChanges(null);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, GIT_POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [branch.path, foreign, readOnly]);

  const peek = (relative: string, name: string) => () =>
    onOpenFile(`${branch.path}/${relative}`, name, branch.name);
  const peekInbox = peek(".ai_mail.local/inbox.json", "inbox.json");
  const peekTodos = peek(".trinity/local.json", "local.json");
  const peekDashboard = peek("DASHBOARD.local.json", "DASHBOARD.local.json");

  const chipClass = [
    "baud-chip",
    branch.dispatched ? "baud-chip-dispatched" : "",
    branch.interactive ? "baud-chip-interactive" : "",
    branch.is_citizen ? "" : "baud-chip-outsider",
  ]
    .filter(Boolean)
    .join(" ");

  const lampClass = branch.dispatched
    ? "baud-lamp-dispatched"
    : branch.interactive
      ? "baud-lamp-interactive"
      : "baud-lamp-dim";

  const badge = branch.dispatched
    ? "dispatched"
    : branch.interactive
      ? "live"
      : branch.has_room
        ? "room"
        : null;
  const badgeClass = branch.dispatched
    ? "baud-badge-dispatched"
    : branch.interactive
      ? "baud-badge-live"
      : "baud-badge-room";

  // A session BAUD never created (boot shim, telegram wake): the doors still reach it, so the badge says whose it is.
  const badgeTitle = branch.outside_room
    ? `alive in tmux session '${branch.outside_room}' - a session BAUD did not create; attach and end room reach it anyway`
    : undefined;

  // Any live session, BAUD's or outside, means attach: never a second claude in the same branch.
  const attached = (branch.has_room || branch.outside_room !== null) && branch.interactive;

  // `-c` covers interactive history; `--resume <id>` covers a branch with only headless dispatch transcripts.
  const canResume = branch.has_history || branch.resume_id !== null;

  return (
    <article className={chipClass}>
      <header className="baud-chip-head">
        <span className={`baud-lamp ${lampClass}`} aria-hidden="true" />
        {/* Manager stays blue-family, never red: red is the alarm colour and ownership is not an alarm. */}
        <button
          type="button"
          className={`baud-chip-avatar ${branch.manager ? "baud-chip-avatar-manager" : ""} ${
            branch.subagents > 0 ? "baud-chip-avatar-busy" : ""
          }`}
          title={
            branch.subagents > 0
              ? `open ${branch.name}'s passport — ${branch.subagents} sub-agent(s) running inside this session`
              : `open ${branch.name}'s passport`
          }
          onClick={() => onOpenPassport(branch)}
        >
          {branch.name.slice(0, 2).toUpperCase()}
        </button>
        <h2 className="baud-chip-name">{branch.name}</h2>
        {branch.manager ? (
          <span
            className="baud-chip-manager"
            title="manager — this project's owner: git write, feedback channel, watchdog"
          >
            ★
          </span>
        ) : null}
        {badge ? (
          <span className={`baud-badge ${badgeClass}`} title={badgeTitle}>
            {badge}
            {branch.outside_room ? <span className="baud-badge-outside">⧉</span> : null}
          </span>
        ) : null}
        {/* Sub-agents never reach the process table; this count is the transcript's unanswered spawn calls. */}
        {branch.subagents > 0 ? (
          <span
            className="baud-badge baud-badge-subagents"
            title={`${branch.subagents} sub-agent(s) running inside this session`}
          >
            {branch.subagents} sub
          </span>
        ) : null}
        {foreign ? (
          <span className="baud-chip-project" title={`seated elsewhere: this agent lives in ${branch.project}`}>
            {branch.project}
          </span>
        ) : null}
        {branch.is_citizen && !foreign && !readOnly ? (
          <button
            type="button"
            className="baud-chip-help"
            title={`open a terminal in ${branch.name} with '${helpCommand(branch.name)}' run - and keep typing`}
            onClick={() => onHelp(branch)}
          >
            ?
          </button>
        ) : null}
        {branch.is_citizen && !foreign && !readOnly ? (
          <button
            type="button"
            className="baud-chip-gear"
            title={`${branch.name}'s settings - model, auto-compact, context threshold`}
            onClick={() => onSettings(branch)}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3.4" />
              <path d="M20.2 14.6a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.3a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3.4a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3.4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.3a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
        ) : null}
      </header>

      {/* No summary line: the dashboard's summary repeats these counts. */}
      <div className="baud-chip-figures">
        <Figure
          label="mail"
          value={branch.new_mail}
          alert={branch.new_mail > 0}
          onClick={foreign ? null : peekInbox}
        />
        <Figure label="open" value={branch.opened_mail} onClick={foreign ? null : peekInbox} />
        <Figure
          label="plans"
          value={branch.active_plans}
          onClick={foreign ? null : peekDashboard}
        />
        <Figure label="todos" value={branch.todo_count} onClick={foreign ? null : peekTodos} />
        {foreign ? null : (
          <button
            type="button"
            className={`baud-figure ${(changes?.count ?? 0) > 0 ? "baud-figure-git" : ""}`}
            title={
              (changes?.count ?? 0) > 0
                ? `${changes?.count} uncommitted file(s) - open the diff`
                : "no uncommitted changes - open the (empty) diff"
            }
            onClick={() => onOpenDiff(branch)}
          >
            <span className="baud-figure-value">{changes?.count ?? 0}</span>
            <span className="baud-figure-label">⎇ git</span>
          </button>
        )}
      </div>

      <footer className="baud-chip-foot">
        <span className={`baud-chip-age ${age.stale ? "baud-chip-age-stale" : ""}`}>
          updated {age.label}
        </span>
        {branch.is_citizen && !readOnly ? (
          <span className="baud-chip-buttons">
            {foreign ? null : (
              <button
                type="button"
                className="baud-chip-launch baud-chip-launch-quiet"
                title={`browse ${branch.path}`}
                onClick={() => onFiles(branch)}
              >
                files
              </button>
            )}
            {foreign ? null : (
              <button
                type="button"
                className="baud-chip-launch baud-chip-launch-quiet"
                title={`watch ${branch.name}'s live activity - read-only monitor pane`}
                onClick={() => onMonitor(branch)}
              >
                watch
              </button>
            )}
            <button
              type="button"
              className="baud-chip-launch baud-chip-launch-quiet baud-chip-shell"
              title={`open a terminal in ${branch.path}`}
              onClick={() => onShell(branch)}
            >
              ❯_
            </button>
            {attached ? (
              <button
                type="button"
                className="baud-chip-launch"
                title={
                  branch.outside_room
                    ? `attach to '${branch.outside_room}' - the live session in this branch, which BAUD did not create`
                    : "attach to the live session in this room"
                }
                onClick={() => onLaunch(branch, "resume")}
              >
                ▸ attach
              </button>
            ) : (
              <>
                {/* Resuming a dispatched session steals its background-task state and kills the job, so
                    the click watches instead. Fresh stays: a new session id steals nothing. */}
                {canResume && branch.dispatched ? (
                  <button
                    type="button"
                    className="baud-chip-launch baud-chip-launch-quiet"
                    title={`agent is working (dispatched) — resume would kill its background tasks; watch instead, or wait for it to finish`}
                    onClick={() => onMonitor(branch)}
                  >
                    ⏳ working
                  </button>
                ) : canResume ? (
                  <button
                    type="button"
                    className="baud-chip-launch"
                    title={
                      branch.resume_id
                        ? `cd ${branch.path} and resume the branch's recorded session`
                        : `cd ${branch.path} and continue the claude conversation`
                    }
                    onClick={() => onLaunch(branch, "resume")}
                  >
                    ▸ resume
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`baud-chip-launch ${canResume ? "baud-chip-launch-quiet" : ""}`}
                  title={`cd ${branch.path} and start a fresh claude`}
                  onClick={() => onLaunch(branch, "fresh")}
                >
                  {canResume ? "fresh" : "▸ claude"}
                </button>
              </>
            )}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

function Figure({
  label,
  value,
  alert,
  onClick,
}: {
  label: string;
  value: number;
  alert?: boolean;
  /** null on a roster card: the number is true, but its file is out of fence. */
  onClick: (() => void) | null;
}) {
  const className = `baud-figure ${alert ? "baud-figure-alert" : ""}`;
  if (!onClick) {
    return (
      <span className={`${className} baud-figure-flat`} title={`${label}, read from another project`}>
        <span className="baud-figure-value">{value}</span>
        <span className="baud-figure-label">{label}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={className}
      title={`open the file behind '${label}'`}
      onClick={onClick}
    >
      <span className="baud-figure-value">{value}</span>
      <span className="baud-figure-label">{label}</span>
    </button>
  );
}
