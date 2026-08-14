import { useEffect, useState } from "react";
import { gitChanges } from "../host";

import { relativeAge } from "../age";
import { helpCommand } from "./InquiryPane";
import type { BranchStatus, GitChanges } from "../types";

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
  /**
   * This card is from a project the view is NOT seated in - a roster card.
   * Every fenced door (files, diff, figures, settings) reads under the seat's
   * root and would simply refuse here, so a foreign card shows what it knows
   * and offers only the doors that genuinely work from where we stand.
   */
  foreign: boolean;
  /** Operator clicked watch: open this branch's scoped monitor pane. */
  onMonitor: (branch: BranchStatus) => void;
  /** Operator clicked ?: open a help terminal seated in this branch. */
  onHelp: (branch: BranchStatus) => void;
  /** Operator clicked the gear: open this branch's settings panel (m11). */
  onSettings: (branch: BranchStatus) => void;
}

/**
 * One citizen, one card: lamp, name, state badge, every quick_status figure,
 * the summary line, and how fresh the dashboard is. The card IS the report -
 * nothing hides in a tooltip anymore.
 *
 * The lamp tells dispatched from interactive apart: a dispatched agent pulses
 * (the machine is churning), an interactive session burns steady (someone is
 * at the wheel), and a branch with neither sits dim.
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
  foreign,
}: BranchChipProps) {
  const age = relativeAge(branch.last_updated);

  // Uncommitted-changes count, straight from local git on its own slow tick.
  // Zero (or a dir that isn't a repo) simply shows no badge.
  const [changes, setChanges] = useState<GitChanges | null>(null);
  useEffect(() => {
    // A foreign path fails the fence by design - asking every 15 seconds
    // would be a guaranteed rejection on a loop.
    if (foreign) return;
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
  }, [branch.path, foreign]);

  // Every number on the card is a door: clicking it opens the file the
  // number came from, in the reading room.
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

  // Room (m6): a parked tmux session with nothing live inside still deserves
  // a quiet tag - there is a scrollback and a shell waiting behind the card.
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

  // The agent is alive in a session BAUD never created (m12) - the boot
  // shim's `aipass-<branch>`, a telegram wake. Say so on the badge rather
  // than let the card imply BAUD owns it: the doors below reach it, and the
  // operator should know exactly what they will attach to and end.
  const badgeTitle = branch.outside_room
    ? `alive in tmux session '${branch.outside_room}' - a session BAUD did not create; attach and end room reach it anyway`
    : undefined;

  // One live session for this branch, whoever made it: BAUD's own room, or
  // the outside one. Either way the door is attach - never a second claude
  // in the same branch.
  const attached = (branch.has_room || branch.outside_room !== null) && branch.interactive;

  // Two ways back into a conversation: `-c` for interactive history, and
  // `--resume <id>` for a branch whose only transcripts are headless dispatch
  // runs. Either way the operator gets a resume button.
  const canResume = branch.has_history || branch.resume_id !== null;

  return (
    <article className={chipClass}>
      <header className="baud-chip-head">
        <span className={`baud-lamp ${lampClass}`} aria-hidden="true" />
        <h2 className="baud-chip-name">{branch.name}</h2>
        {/* Manager class: the project's first agent and its owner, the only
            one holding git write, the feedback channel and watchdog. Rare by
            construction (one per project), so a bare mark carries it and the
            title does the teaching. */}
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
        {/* Sub-agents are invisible to the process table (they run inside the
            parent claude) - this count comes from the session transcript:
            spawn calls still waiting on their results. */}
        {branch.subagents > 0 ? (
          <span
            className="baud-badge baud-badge-subagents"
            title={`${branch.subagents} sub-agent(s) running inside this session`}
          >
            {branch.subagents} sub
          </span>
        ) : null}
        {/* Tier-1 (m9 phase 4): a real terminal seated in this branch with
            the agent's help already run - keyboard ON, the operator keeps
            investigating (Patrick ruling: blocking it defeats the point). */}
        {/* Which tree this passport is from. Only on roster cards - on the
            seated project's own strip it would be the same word on every
            card, and the chip above already says it. */}
        {foreign ? (
          <span className="baud-chip-project" title={`seated elsewhere: this agent lives in ${branch.project}`}>
            {branch.project}
          </span>
        ) : null}
        {branch.is_citizen && !foreign ? (
          <button
            type="button"
            className="baud-chip-help"
            title={`open a terminal in ${branch.name} with '${helpCommand(branch.name)}' run - and keep typing`}
            onClick={() => onHelp(branch)}
          >
            ?
          </button>
        ) : null}
        {/* m11: this branch's own settings - model, auto-compact, context
            threshold. The panel writes claude's settings.local.json, so it
            only exists for branches that are actually citizens. */}
        {branch.is_citizen && !foreign ? (
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

      {/* No summary line: the dashboard's summary string is generated from
          the same counts the figures below already show - it was the same
          info twice (Patrick-caught 2026-08-09). Dashboard opens via plans. */}
      {/* On a roster card the figures still READ true - the roster scan
          gathered them - but they are not doors: every one opens a file
          under the seat's fence, which would refuse. Numbers without a
          click, rather than a click that always fails. */}
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
        {/* Permanent spot (Patrick ruling 2026-08-09): a dim zero when the
            tree is clean, amber the moment anything is uncommitted. */}
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
        {branch.is_citizen ? (
          <span className="baud-chip-buttons">
            {/* files and watch read under the seat's fence - on a roster
                card they would refuse, so the card does not offer them. The
                launch door and the shell below both work from anywhere. */}
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
            {/* Tier-0, scoped (m9): this branch's prax activity alone, in a
                read-only pane. A window, never a seat - same doctrine as the
                header lights, one card wide. */}
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
            {/* A plain working shell seated in this branch. Not a seat for
                the agent and not the branch's room - just a prompt already
                cd'd where the operator was about to cd anyway. */}
            <button
              type="button"
              className="baud-chip-launch baud-chip-launch-quiet baud-chip-shell"
              title={`open a terminal in ${branch.path}`}
              onClick={() => onShell(branch)}
            >
              ❯_
            </button>
            {attached ? (
              /* A live session in the room: every door is the same door -
                 attach and pick up mid-scroll. No command gets typed. Since
                 m12 that includes a session BAUD did not create - otherwise
                 this card offered "resume" and started a SECOND claude in a
                 branch that already had one. */
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
                {canResume ? (
                  <button
                    type="button"
                    className="baud-chip-launch"
                    title={
                      branch.has_history
                        ? `cd ${branch.path} and continue the claude conversation`
                        : `cd ${branch.path} and reopen the last dispatch transcript`
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
