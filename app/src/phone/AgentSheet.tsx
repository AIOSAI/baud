/** The expanded agent card a tap on the centred chip opens. Reference: docs/phone/card.md */

import { useEffect, useState } from "react";

import { gitChanges } from "../host";
import type { BranchStatus } from "../types";
import VerbChips from "./VerbChips";
import { isAwake } from "./FleetWheel";
import { INTERCEPT_WINDOW_MS, interceptTap } from "./lib/intercept";
import { mailFigure } from "./lib/mailFigure";
import { type LaunchMode, type RoomDoor, helpCommand, roomDoors } from "./lib/rooms";
import { type Scope, scopeRefusal } from "./lib/verbs";

/** The one file this card opens in the plain reader, by the name @api's fence takes. */
const README_FILE = "README.md";

/** A monitor this card can open - manager-class agents only. */
export interface SheetMonitor {
  id: string;
  label: string;
  hint: string;
  /** Absent = this face has no route for it, and the hint says which. */
  open: (() => void) | null;
}

interface AgentSheetProps {
  branch: BranchStatus;
  /** The project the phone is seated in; only the settings gear refuses a card from elsewhere. */
  seatedProject: string;
  scope: Scope;
  /** Open a read - files only; the tiles open designed screens through doors of their own. */
  onRead: (ref: string, title: string, kind: "file") => void;
  onInbox: () => void;
  onPlans: () => void;
  onTodos: () => void;
  onGit: () => void;
  onFiles: () => void;
  /** Open an EMPTY terminal in this branch's directory - its own `baud-shell-*` room, not the agent's. */
  onShell: () => void;
  /** Open that shell with `drone @<branch> --help` already run; `rooms.ts` owns the command, not the card. */
  onHelp: () => void;
  /** Watch this branch's activity - read-only by contract, both ends. */
  onWatch: () => void;
  onSettings: () => void;
  onMemory: () => void;
  monitors: SheetMonitor[];
  /** Open the passport - a door, not the avatar: the phone's avatar sits inside the chip's tap target. */
  onPassport: () => void;
  onAttach: (mode: LaunchMode) => void;
  isAttachedRoom: boolean;
  /** Close the client below. The room, the agent and the scrollback survive. */
  onDetach: () => void;
  /**
   * `end room` came back ok - the session is gone, so the client goes too: the sheet
   * reconnects by itself, and `new-session -A` would build an empty room under the dead name.
   */
  onEnded: () => void;
  onClose: () => void;
}

export default function AgentSheet({
  branch,
  scope,
  onRead,
  onInbox,
  onPlans,
  onTodos,
  onGit,
  seatedProject,
  onFiles,
  onShell,
  onHelp,
  onWatch,
  onSettings,
  onMemory,
  monitors,
  onPassport,
  onAttach,
  isAttachedRoom,
  onDetach,
  onEnded,
  onClose,
}: AgentSheetProps) {
  // The git count, fetched for this open card only (the fleet read does not carry it).
  // A lane that cannot answer is its own state: painted as 0 it would read as "clean".
  const [changes, setChanges] = useState<
    { state: "asking" } | { state: "count"; count: number } | { state: "unavailable"; why: string }
  >({ state: "asking" });
  useEffect(() => {
    let current = true;
    setChanges({ state: "asking" });
    // The NAME, never `branch.path`: this transport is fenced on names. The project
    // rides beside it because two projects can hold a same-named branch.
    gitChanges(branch.name, branch.project)
      .then((result) => {
        if (current) setChanges({ state: "count", count: result.count });
      })
      .catch((cause) => {
        if (current) setChanges({ state: "unavailable", why: String(cause?.message ?? cause) });
      });
    return () => {
      current = false;
    };
  }, [branch.name, branch.project]);

  /** When the intercept door was armed, or null: a second tap inside the window fires it (`lib/intercept.ts`). */
  const [armedAt, setArmedAt] = useState<number | null>(null);
  useEffect(() => {
    if (armedAt === null) return;
    const timer = window.setTimeout(() => setArmedAt(null), INTERCEPT_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [armedAt]);
  const pressDoor = (door: RoomDoor) => {
    const now = Date.now();
    if (interceptTap(Boolean(door.intercept), armedAt, now) === "arm") {
      setArmedAt(now);
      return;
    }
    setArmedAt(null);
    onAttach(door.mode);
  };

  const away =
    branch.project && seatedProject && branch.project !== seatedProject ? branch.project : null;

  // Only settings is fenced across projects: its route takes no project, so on a
  // foreign card it would open (and edit) the seated project's same-named agent.
  const settingsElsewhere = away
    ? `${branch.name}'s settings live in ${away}, and this door names no project — it would open the seated project's ${branch.name}. Switch to ${away} first.`
    : null;
  const refusal = scopeRefusal(scope);
  const state = branch.dispatched ? "dispatched" : branch.interactive ? "interactive" : "idle";
  const kind = branch.manager ? "manager" : branch.is_citizen ? "citizen" : "branch";

  const stats: ReadonlyArray<{
    figure: string;
    label: string;
    hint?: string;
    words?: boolean;
    open?: () => void;
  }> = [
    {
      // Opened mail too: the rail's badge counts it, and the tile must add up to the badge.
      figure: mailFigure(branch.new_mail, branch.opened_mail),
      label: "MAIL",
      words: true,
      open: onInbox,
    },
    {
      figure: String(branch.active_plans),
      label: "PLANS",
      open: onPlans,
    },
    {
      figure: String(branch.todo_count),
      label: "TODOS",
      open: onTodos,
    },
    {
      figure:
        changes.state === "count" ? String(changes.count) : changes.state === "unavailable" ? "n/a" : "—",
      label: "GIT",
      hint: changes.state === "unavailable" ? changes.why : undefined,
      open: onGit,
    },
  ];

  const doors = roomDoors(branch);
  const intercept = doors.find((door) => door.intercept) ?? null;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop dismissal; every control inside is a real button.
    <div
      className="baud-agent-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="baud-agent-card"
        // Any tap but the intercept door disarms it; capture, so it runs before the pressed door.
        onClickCapture={(event) => {
          if (armedAt !== null && !(event.target as Element).closest?.("[data-intercept]")) {
            setArmedAt(null);
          }
        }}
      >
        {/* Settings and `?` are header chips: siblings of the name, each in its own 40px box, never nested targets. */}
        <div className="baud-agent-head">
          <button
            type="button"
            className="baud-agent-name"
            title={`read ${branch.name}'s README`}
            onClick={() =>
              onRead(`${branch.name}/${README_FILE}`, `${branch.name} · readme`, "file")
            }
          >
            {branch.name.toUpperCase()}
          </button>
          {/* Not fenced: a foreign or address-less branch gets @api's or drone's own refusal
              in the terminal it opens, which beats a guess at the door. */}
          <button
            type="button"
            className="baud-agent-chip"
            title={`open ${branch.name}'s shell with '${helpCommand(branch.name)}' already run — and keep typing`}
            aria-label="help"
            onClick={onHelp}
          >
            <span className="baud-agent-chip-face">?</span>
          </button>
          {/* The one fenced door: its route takes no project. Inline SVG, the same paths as
              the phone header's gear, not the emoji. */}
          <button
            type="button"
            className="baud-agent-chip"
            disabled={Boolean(settingsElsewhere)}
            title={
              settingsElsewhere ??
              `${branch.name}'s claude settings - model and auto-compact, the desktop's own panel`
            }
            aria-label="settings"
            onClick={onSettings}
          >
            <span className="baud-agent-chip-face">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3.4" />
                <path d="M20.2 14.6a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.3a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3.4a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3.4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.3a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </span>
          </button>
        </div>
        <p className="baud-agent-sub">
          {kind} · <span className={isAwake(branch) ? "baud-agent-awake" : ""}>{state}</span>
        </p>
        {/* Zero is stated, not hidden: a sheet silent at zero cannot be told from one that
            does not report sub-agents, and the desktop passport says "none running". */}
        <p
          className={`baud-agent-subagents ${
            branch.subagents > 0 ? "baud-agent-subagents-live" : ""
          }`}
        >
          {branch.subagents > 0
            ? `▸ ${branch.subagents} sub-agent${branch.subagents === 1 ? "" : "s"} running inside this session`
            : "no sub-agents running"}
        </p>
        {isAttachedRoom ? (
          <p className="baud-agent-here">▸ this room is open in the terminal below</p>
        ) : null}
        {/* Names the gear in words: a dashed icon cannot explain itself and a title never shows on touch. */}
        {away ? (
          <p className="baud-agent-away">
            {branch.name} lives in {away} — read it, watch it, attach it from here. Only the{" "}
            <b>settings</b> gear, top right, stays behind: that door names no project.
          </p>
        ) : null}

        <div className="baud-agent-stats">
          {stats.map((stat) => (
            <button
              key={stat.label}
              type="button"
              className={stat.words ? "baud-agent-stat baud-agent-stat-words" : "baud-agent-stat"}
              title={stat.hint}
              onClick={stat.open}
            >
              <b>{stat.figure}</b>
              <span>{stat.label}</span>
            </button>
          ))}
        </div>
        {changes.state === "unavailable" ? (
          <p className="baud-phone-said baud-agent-why">GIT n/a — {changes.why}</p>
        ) : null}

        <nav className="baud-agent-doors">
          {/* A live room offers ONE door (the double-claude guard, `rooms.ts`). On the card whose
              room is below, detach replaces the doors; it closes a client, unlike `end room`. */}
          {isAttachedRoom ? (
            <button
              type="button"
              className="baud-agent-door baud-agent-go baud-agent-detach"
              title="close this client - the room and whatever runs in it keep running"
              onClick={onDetach}
            >
              ‹ detach
            </button>
          ) : (
            doors.map((door) => {
              const armed = Boolean(door.intercept) && armedAt !== null;
              return (
                <button
                  key={door.label}
                  type="button"
                  className={`baud-agent-door baud-agent-go ${armed ? "baud-agent-armed" : ""}`}
                  data-intercept={door.intercept ? "" : undefined}
                  disabled={Boolean(refusal)}
                  title={refusal ?? door.title}
                  onClick={() => pressDoor(door)}
                >
                  {armed ? "▸ tap again ⚡" : door.label}
                </button>
              );
            })
          )}
          <button
            type="button"
            className="baud-agent-door"
            title={`browse ${branch.name}'s files - read only`}
            onClick={onFiles}
          >
            files
          </button>
          <button
            type="button"
            className="baud-agent-door"
            title={
              `open an empty terminal in ${branch.name}'s directory - its own room, not the agent's`
            }
            onClick={onShell}
          >
            shell
          </button>
          <button
            type="button"
            className="baud-agent-door"
            title={`watch ${branch.name}'s activity - read only, both ends of the wire`}
            onClick={onWatch}
          >
            watch
          </button>
          <button
            type="button"
            className="baud-agent-door"
            title={`${branch.name}'s working memory - sessions, learnings, todos, observations`}
            onClick={onMemory}
          >
            memory
          </button>
        </nav>
        {/* Titles never show on touch, so the refusal or the ⚡ warning is said here; a refusal outranks it. */}
        {!isAttachedRoom && refusal ? (
          <p className="baud-phone-said baud-agent-why">{refusal}</p>
        ) : !isAttachedRoom && intercept ? (
          <p className={`baud-phone-said baud-agent-why ${armedAt !== null ? "baud-agent-why-armed" : ""}`}>
            {armedAt !== null
              ? `armed — tap ${intercept.label} again within ${INTERCEPT_WINDOW_MS / 1000}s to stop the job and resume; any other tap cancels`
              : `${intercept.label}: ${intercept.title}`}
          </p>
        ) : null}

        {monitors.length > 0 ? (
          <section className="baud-agent-zone">
            <p className="baud-agent-zonelabel">MANAGER</p>
            <nav className="baud-agent-doors">
              {monitors.map((monitor) => (
                <button
                  key={monitor.id}
                  type="button"
                  className="baud-agent-door"
                  disabled={!monitor.open}
                  title={monitor.hint}
                  onClick={() => monitor.open?.()}
                >
                  {monitor.label}
                </button>
              ))}
            </nav>
            {monitors
              .filter((monitor) => !monitor.open)
              .map((monitor) => (
                <p key={monitor.id} className="baud-phone-said baud-agent-why">
                  {monitor.label}: {monitor.hint}
                </p>
              ))}
          </section>
        ) : null}

        <section className="baud-agent-zone">
          <p className="baud-agent-zonelabel">IDENTITY</p>
          <nav className="baud-agent-doors">
            <button
              type="button"
              className="baud-agent-door baud-agent-door-wide"
              title={`${branch.name}'s passport - the identity document, nothing operational`}
              onClick={onPassport}
            >
              passport
            </button>
          </nav>
        </section>

        {/* Kept from the old column: without it `end room` has no door on the phone. */}
        <VerbChips branch={branch} scope={scope} onEnded={onEnded} />

        <p className="baud-agent-closer">tap outside to close</p>
      </section>
    </div>
  );
}

