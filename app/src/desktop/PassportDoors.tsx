import { useEffect, useState } from "react";
import { gitChanges } from "../host";

import { relativeAge } from "../age";
import { awayNote, type CardDoor, cardDoorView, gearFence } from "./cardDoors";
import { helpCommand } from "./InquiryPane";
import type { BranchStatus, GitChanges } from "../types";
import type { PhoneView } from "./phoneView";

export type LaunchMode = "resume" | "fresh";

/** Git polls slower than the dashboard: a subprocess per card per tick is
 *  real work, and uncommitted-file counts don't move second to second. */
export const GIT_POLL_MS = 15_000;

interface PassportDoorsProps {
  branch: BranchStatus;
  /** A roster card from an unseated project: its reads name its own project; only the settings gear is fenced. */
  foreign: boolean;
  onLaunch: (branch: BranchStatus, mode: LaunchMode) => void;
  /** The seated branch's directory tree; a roster card browses through the files screen instead. */
  onFiles: (branch: BranchStatus) => void;
  onShell: (branch: BranchStatus) => void;
  onMonitor: (branch: BranchStatus) => void;
  onHelp: (branch: BranchStatus) => void;
  onSettings: (branch: BranchStatus) => void;
  /** Opens or fronts a phone-screen tab for one of this card's designed reads. */
  onOpenPhone: (view: PhoneView) => void;
}

/**
 * The opened card's doors: launch, files, shell, watch, help, settings, the figures and the sub-agent badge.
 * The round card on the wheel shows state, mail and memory only. Reference: docs/desktop/window-and-cards.md
 */
export default function PassportDoors({
  branch,
  onLaunch,
  onFiles,
  onMonitor,
  onShell,
  onHelp,
  onSettings,
  onOpenPhone,
  foreign,
}: PassportDoorsProps) {
  const age = relativeAge(branch.last_updated);

  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [gitWhy, setGitWhy] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      // A foreign path fails the seat's fence, so a roster card asks by name over the relay, project named.
      (foreign ? gitChanges(branch.name, branch.project) : gitChanges(branch.path))
        .then((next) => {
          if (!mounted) return;
          setChanges(next);
          setGitWhy(null);
        })
        .catch((cause) => {
          if (!mounted) return;
          setChanges(null);
          setGitWhy(String(cause?.message ?? cause));
        });
    };
    refresh();
    const timer = window.setInterval(refresh, GIT_POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [branch.path, branch.name, branch.project, foreign]);

  const door = (which: CardDoor) => () => onOpenPhone(cardDoorView(which, branch));
  // A roster card's unanswered relay must not paint as 0, which reads as clean; the seated card keeps its 0.
  const gitFigure = changes ? String(changes.count) : foreign ? (gitWhy ? "n/a" : "—") : "0";

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
    <article className="baud-chip baud-passport-doors">
      <header className="baud-chip-head">
        {badge ? (
          <span className={`baud-badge ${badgeClass}`} title={badgeTitle}>
            {badge}
            {branch.outside_room ? <span className="baud-badge-outside">⧉</span> : null}
          </span>
        ) : null}
        {(branch.provider ?? "claude") !== "claude" ? <span className="baud-chip-project">{branch.provider}</span> : null}
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
        {branch.is_citizen ? (
          <button
            type="button"
            className="baud-chip-help"
            title={`open a terminal in ${branch.name} with '${helpCommand(branch.name)}' run - and keep typing`}
            onClick={() => onHelp(branch)}
          >
            ?
          </button>
        ) : null}
        {branch.is_citizen ? (
          <button
            type="button"
            className="baud-chip-gear"
            disabled={foreign}
            title={
              foreign
                ? gearFence(branch.name, branch.project)
                : `${branch.name}'s settings - model, auto-compact, context threshold`
            }
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

      {foreign && branch.is_citizen ? (
        <p className="baud-chip-away">{awayNote(branch.name, branch.project)}</p>
      ) : null}

      {/* No summary line: the dashboard's summary repeats these counts. */}
      <div className="baud-chip-figures">
        <Figure
          label="mail"
          value={branch.new_mail}
          alert={branch.new_mail > 0}
          screen="inbox screen"
          onClick={door("inbox")}
        />
        <Figure label="open" value={branch.opened_mail} screen="inbox screen" onClick={door("inbox")} />
        <Figure label="plans" value={branch.active_plans} screen="plans screen" onClick={door("plans")} />
        <Figure label="todos" value={branch.todo_count} screen="memory screen, on todos" onClick={door("todos")} />
        <button
          type="button"
          className={`baud-figure ${(changes?.count ?? 0) > 0 ? "baud-figure-git" : ""}`}
          title={
            foreign && gitWhy
              ? `git count n/a - ${gitWhy}; open the git app`
              : (changes?.count ?? 0) > 0
                ? `${changes?.count} uncommitted file(s) - open the git app on them`
                : "no uncommitted changes - open the git app"
          }
          onClick={door("git")}
        >
          <span className="baud-figure-value">{gitFigure}</span>
          <span className="baud-figure-label">⎇ git</span>
        </button>
      </div>

      <footer className="baud-chip-foot">
        <span className={`baud-chip-age ${age.stale ? "baud-chip-age-stale" : ""}`}>
          updated {age.label}
        </span>
        {branch.is_citizen ? (
          <span className="baud-chip-buttons">
            {/* The tree reads under the seat, so a roster card browses through the files screen instead. */}
            <button
              type="button"
              className="baud-chip-launch baud-chip-launch-quiet"
              title={
                foreign ? `browse ${branch.name}'s files in ${branch.project} - read only` : `browse ${branch.path}`
              }
              onClick={foreign ? door("files") : () => onFiles(branch)}
            >
              files
            </button>
            <button
              type="button"
              className="baud-chip-launch baud-chip-launch-quiet"
              title={`watch ${branch.name}'s live activity - read-only monitor pane`}
              onClick={() => onMonitor(branch)}
            >
              watch
            </button>
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
  screen,
  onClick,
}: {
  label: string;
  value: number;
  alert?: boolean;
  /** The designed screen the click opens, named on the title. */
  screen: string;
  onClick: () => void;
}) {
  const className = `baud-figure ${alert ? "baud-figure-alert" : ""}`;
  return (
    <button type="button" className={className} title={`open the ${screen}`} onClick={onClick}>
      <span className="baud-figure-value">{value}</span>
      <span className="baud-figure-label">{label}</span>
    </button>
  );
}
