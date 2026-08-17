/**
 * The expanded card - what a tap on the centred chip opens (FPLAN-0423).
 *
 * The approved shape calls for "the desktop-card feel": name, class, state, a
 * stats row, and a row of doors. That is the desktop's `BranchChip` read back
 * at phone scale, so this file ports its vocabulary rather than inventing a
 * second one - the same words for the same states, because an operator who
 * learns "dispatched" at the desk should not meet "busy" in a pocket.
 *
 * THE STATS ARE DOORS, which is the one place I read the shape rather than
 * copying it. The probe's tiles are dead text, but on the desktop those same
 * figures ARE the read affordance - clicking the mail count opens the mailbox.
 * Keeping them live is what makes this feel like the desktop card instead of a
 * picture of one, and it is why the reads survived the column being deleted.
 * Called out in the reply as a judgment, not smuggled in.
 */

import { useEffect, useState } from "react";

import { gitChanges } from "../host";
import type { BranchStatus } from "../types";
import VerbChips from "./VerbChips";
import { isAwake } from "./FleetWheel";
import { type LaunchMode, roomDoors } from "./rooms";
import { type Scope, scopeRefusal } from "./verbs";

/** The files behind the figures, by the names @api's fence takes. */
const MAIL_FILE = ".ai_mail.local/inbox.json";
const PLANS_FILE = "DASHBOARD.local.json";
const TODOS_FILE = ".trinity/local.json";
const README_FILE = "README.md";

interface AgentSheetProps {
  branch: BranchStatus;
  /**
   * The project the phone is seated in.
   *
   * A card reached from the live or dispatched wheel can live somewhere else,
   * and this is what "somewhere else" is measured against. Since the
   * one-terminal ruling it decides almost nothing: every door but `settings`
   * works on a foreign card, and this value is what that one refusal names.
   * See the fence note in the body for what each retreat cost.
   */
  seatedProject: string;
  scope: Scope;
  /** Open a read - the same reader the column used. */
  onRead: (ref: string, title: string, kind: "file" | "diff") => void;
  /** Open the branch's file browser - the files door, live since 08-15. */
  onFiles: () => void;
  /** Open an EMPTY terminal in this branch's directory - the desktop card's
   *  shell button. A different room than the agent's (`baud-shell-*`), so it
   *  is offered even while the agent's own room is the one on screen. */
  onShell: () => void;
  /** Watch this branch's activity - the desktop card's monitor pane (m9),
   *  live in the stage since 08-16. Read-only by contract, both ends. */
  onWatch: () => void;
  /** Open this branch's claude settings - the desktop card's gear. The panel
   *  itself is the desktop's own component; only the door lives here. */
  onSettings: () => void;
  /**
   * Open the passport - the transfer round's document.
   *
   * A DOOR, NOT THE AVATAR, which is where the desk puts it. On the desk the
   * avatar is a 26px disc sitting alone on a card; here the equivalent disc
   * lives on the wheel, INSIDE the tap target that opens this sheet. Nesting a
   * second target inside the first at that size is a mis-tap machine, and the
   * one it would steal is the gesture the whole face is built on. So the
   * passport joins the door row, finger-sized, next to the other four.
   */
  onPassport: () => void;
  /** Go through to the room, by the door the operator pressed. */
  onAttach: (mode: LaunchMode) => void;
  /**
   * Is THIS the agent whose room is currently open below? The card is the
   * detail layer for one agent, so the answer changes what it offers: a card
   * whose room is already on screen has nothing to attach to, it has something
   * to close.
   */
  isAttachedRoom: boolean;
  /** Close the client below. The room, the agent and the scrollback survive. */
  onDetach: () => void;
  onClose: () => void;
}

export default function AgentSheet({
  branch,
  scope,
  onRead,
  seatedProject,
  onFiles,
  onShell,
  onWatch,
  onSettings,
  onPassport,
  onAttach,
  isAttachedRoom,
  onDetach,
  onClose,
}: AgentSheetProps) {
  /**
   * The git count, fetched for THIS card only and only once it is open.
   *
   * The fleet read does not carry it - the desktop gets it from a separate
   * `git_changes` call per card on a slow tick. Fanning that out across a rail
   * of seventeen would be seventeen calls for one number nobody is looking at;
   * asking for the one card that is open costs one, when it is asked for.
   */
  /**
   * THREE ANSWERS, NOT TWO - and the third is the reason this is not a number
   * with a fallback. A count of 0 says "nothing has changed here", which is a
   * FACT about the branch. A lane that cannot answer must not be able to
   * produce that sentence: an empty list painted as clean is the one lie a
   * glance would read as truth and act on.
   *
   * So a refusal is its own state with its own face. `n/a` is not a number and
   * cannot be mistaken for one; the em dash stays for "asking" and for a
   * branch that simply has no git, which are absences rather than failures.
   */
  const [changes, setChanges] = useState<
    { state: "asking" } | { state: "count"; count: number } | { state: "unavailable"; why: string }
  >({ state: "asking" });
  useEffect(() => {
    let current = true;
    setChanges({ state: "asking" });
    // The NAME, never `branch.path`: this transport is fenced on names and
    // refuses an absolute path by design. The project rides beside it, because
    // two projects can hold a same-named branch.
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

  /** Where this agent lives, when that is not here. */
  const away =
    branch.project && seatedProject && branch.project !== seatedProject ? branch.project : null;

  /*
   * THREE FENCES BECAME ONE - Patrick's one-terminal ruling, 2026-08-16 19:51.
   *
   * His model, and the card is now shaped to it: the terminal is ONE SEAT and
   * just a view. It hosts whichever agent he chooses, wherever that agent was
   * spawned. Chat with @devpulse, browse BAUD's files, watch it, switch to it,
   * come back - all in the one terminal, and whether a project is an AIPass
   * tenant or something external is not a distinction he should have to hold.
   * "When you block you create friction."
   *
   * So the card fences ONE door, and it is worth naming what each retreat cost
   * and why it was right at the time:
   *
   *   reads      - freed when the read routes learned `project`. The blanket
   *                fence had been guarding a real hazard: an unnamed project
   *                resolved under the seat, so a foreign read could find a
   *                same-named local agent's file and show it as this one's.
   *   operate    - freed by this ruling. The attach lane was never actually
   *                fenced server-side; the seat-binding was mine, inherited
   *                from when reads were seat-only, and it outlived its reason.
   *   watch      - freed by MEASUREMENT, not by decree. The refusal existed on
   *                an anchor-tooling rationale that four probes disproved:
   *                @prax refuses nothing and states its own scope on the screen
   *                the operator is already reading ("nothing will be shown for
   *                it"). A live accurate warning beats a guess at the door.
   *   settings   - STILL FENCED, and alone. Its route takes a branch and NO
   *                project, so a foreign card resolves under the seat. This is
   *                the one door that would not fail loudly: it would open, and
   *                edit, a same-named LOCAL agent's claude config while the
   *                header named the foreign one. It stays shut until that route
   *                learns the second half of the address.
   */
  const settingsElsewhere = away
    ? `${branch.name}'s settings live in ${away}, and this door names no project — it would open the seated project's ${branch.name}. Switch to ${away} first.`
    : null;
  // Scope is the only thing left between an operator and a room. Distance is
  // not a reason any more: the terminal is one seat and it goes where it is
  // pointed.
  const refusal = scopeRefusal(scope);
  // The desktop's own three-state word, not a flattened "live". The rail's dot
  // is binary because the shape says so; the detail view can afford the truth.
  const state = branch.dispatched ? "dispatched" : branch.interactive ? "interactive" : "idle";
  const kind = branch.manager ? "manager" : branch.is_citizen ? "citizen" : "branch";

  const stats: ReadonlyArray<{ figure: string; label: string; hint?: string; open?: () => void }> = [
    {
      figure: String(branch.new_mail),
      label: "MAIL",
      open: () => onRead(`${branch.name}/${MAIL_FILE}`, `${branch.name} · inbox`, "file"),
    },
    {
      figure: String(branch.active_plans),
      label: "PLANS",
      open: () => onRead(`${branch.name}/${PLANS_FILE}`, `${branch.name} · dashboard`, "file"),
    },
    {
      figure: String(branch.todo_count),
      label: "TODOS",
      open: () => onRead(`${branch.name}/${TODOS_FILE}`, `${branch.name} · memory`, "file"),
    },
    {
      figure:
        changes.state === "count" ? String(changes.count) : changes.state === "unavailable" ? "n/a" : "—",
      label: "GIT",
      // The tile is a door, and the door refuses in the same voice the tile
      // does: /v1/diff carries the same limits as /v1/git-changes, so a branch
      // whose count is unavailable opens a reader that says why, in @api's own
      // sentence rather than a guess of mine.
      hint: changes.state === "unavailable" ? changes.why : undefined,
      open: () => onRead(branch.name, `${branch.name} · diff`, "diff"),
    },
  ];

  const doors = roomDoors(branch);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop dismissal; every control inside is a real button.
    <div
      className="baud-agent-scrim"
      onClick={(event) => {
        // Only the backdrop itself closes. A click that bubbled up from the
        // card would otherwise dismiss the sheet on every button press.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="baud-agent-card">
        {/* The name is the README door. The column had a row of read buttons
            and the approved shape has no room for one, but a branch's README is
            the document its own agents are told is the source of truth - losing
            the only way to reach it from a pocket would be a real subtraction.
            The title is the most obvious thing to press and it was doing
            nothing. */}
        <button
          type="button"
          className="baud-agent-name"
          title={`read ${branch.name}'s README`}
          onClick={() => onRead(`${branch.name}/${README_FILE}`, `${branch.name} · readme`, "file")}
        >
          {branch.name.toUpperCase()}
        </button>
        <p className="baud-agent-sub">
          {kind} · <span className={isAwake(branch) ? "baud-agent-awake" : ""}>{state}</span> ·{" "}
          {branch.summary || "no summary"}
        </p>
        {/* SUB-AGENTS, and it belongs HERE rather than in the counter row
            below, which was the other candidate. Every tile in that row is a
            DOOR - press MAIL and the inbox opens, press GIT and the diff does.
            Sub-agents have no file to open: the count comes from the session
            transcript and no names exist in that lane, so a fifth tile would
            be a dead button sitting among four live ones, at 46 columns.
            It is also a different KIND of fact. The four counters are standing
            figures always true of a branch; this one appears and vanishes with
            activity, which is what the line above it reports. The rail says
            THAT something is running; this says HOW MANY.
            ZERO IS STATED, NOT HIDDEN, and that is the whole reason this round
            exists: a sheet that renders nothing at zero is indistinguishable
            from a sheet that does not report sub-agents at all, which is
            exactly what cost Patrick his evening. A detail view can afford one
            quiet line, and the desktop passport already prints "none running" -
            two faces must not disagree about the same fact. */}
        <p
          className={`baud-agent-subagents ${
            branch.subagents > 0 ? "baud-agent-subagents-live" : ""
          }`}
        >
          {branch.subagents > 0
            ? `▸ ${branch.subagents} sub-agent${branch.subagents === 1 ? "" : "s"} running inside this session`
            : "no sub-agents running"}
        </p>
        {/* The other half of where the split-naming went. The rail's ring says
            WHICH card owns the terminal at a glance; this says it in words, on
            the one screen where the operator has asked for detail. */}
        {isAttachedRoom ? (
          <p className="baud-agent-here">▸ this room is open in the terminal below</p>
        ) : null}
        {/* Said once, plainly, above the doors that are about to refuse - so the
            greyed row reads as a place the operator is not, rather than as an
            app that has stopped working. */}
        {/* NOT a refusal any more - a fact about WHERE, plus the single door
            that is still shut. The terminal is one seat and goes where it is
            pointed, so saying "lives in VERA-STUDIO" and stopping there would
            read as a wall that is no longer standing. */}
        {away ? (
          <p className="baud-agent-away">
            {branch.name} lives in {away} — read it, watch it, attach it from here. Only{" "}
            <b>settings</b> stays behind, because that door names no project.
          </p>
        ) : null}

        <div className="baud-agent-stats">
          {stats.map((stat) => (
            <button
              key={stat.label}
              type="button"
              className="baud-agent-stat"
              // The FIGURES are honest either way - four of them came with the
              // roster card. The fifth is fetched, so it is the only one that
              // can fail, and when it does the reason travels with it: `n/a` on
              // the face says THIS IS NOT A NUMBER, and the hint says why in
              // @api's own words rather than a guess of mine.
              title={stat.hint}
              onClick={stat.open}
            >
              <b>{stat.figure}</b>
              <span>{stat.label}</span>
            </button>
          ))}
        </div>

        <nav className="baud-agent-doors">
          {/* The room doors are the fleet's own judgment, ported in rooms.ts: a
              live room offers exactly ONE door, which is the structural half of
              the double-claude guard. Under a read token they are refused with
              the reason, never hidden. */}
          {/* DETACH LIVES HERE NOW, and only on the card whose room is below -
              anywhere else it would be a button with nothing to close. It
              REPLACES the attach doors rather than joining them, because "open
              this room" is not an offer you can make about the room already on
              screen. Deliberately worded away from `end room`, which is a
              different and destructive verb sitting a few lines down: this one
              closes a client, and tmux keeps everything. */}
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
            doors.map((door) => (
              <button
                key={door.label}
                type="button"
                className="baud-agent-door baud-agent-go"
                disabled={Boolean(refusal)}
                title={refusal ?? door.title}
                onClick={() => onAttach(door.mode)}
              >
                {door.label}
              </button>
            ))
          )}
          {/* Files came off the desktop-only list 08-15: it no longer opens a
              file manager ON the machine, it browses the branch through the
              same fenced read lane the stats row uses. */}
          <button
            type="button"
            className="baud-agent-door"
            title={`browse ${branch.name}'s files - read only`}
            onClick={onFiles}
          >
            files
          </button>
          {/* The desktop card's shell button, ported: an empty terminal cd'd
              into this branch's directory. NOT the agent's room - its own
              `baud-shell-` session - which is why it sits outside the
              attach/detach swap above and stays offered either way. */}
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
          {/* The LAST desktop-only door goes live (08-16): watch was disabled
              because it wanted a native monitor window on the machine - now
              @api runs the same `drone @prax monitor run` on a read-only PTY
              and streams it, so the phone gets the desktop's pane, not a
              stand-in. The DESKTOP_ONLY list retired with it: every door on
              this card is real now. */}
          <button
            type="button"
            className="baud-agent-door"
            title={`watch ${branch.name}'s activity - read only, both ends of the wire`}
            onClick={onWatch}
          >
            watch
          </button>
          {/* The desktop card's gear (08-16): the same three dials, the same
              panel component, through /v1. Offered on every scope - the dials
              READ on a read token, and a save answers with the server's own
              refusal rather than the door pretending not to exist. */}
          <button
            type="button"
            className="baud-agent-door"
            disabled={Boolean(settingsElsewhere)}
            title={
              settingsElsewhere ??
              `${branch.name}'s claude settings - model and auto-compact, the desktop's own panel`
            }
            onClick={onSettings}
          >
            settings
          </button>
          {/* THE PASSPORT (transfer round): the desk's document, phone-shaped.
              Fenced with the rest - the three .trinity reads go down the same
              named-file lane every door on this row uses, so a card from
              another project refuses here exactly as it refuses everywhere
              else, in the same sentence. */}
          <button
            type="button"
            className="baud-agent-door"
            title={`${branch.name}'s passport - identity, principles and working memory`}
            onClick={onPassport}
          >
            passport
          </button>
        </nav>

        {/* The phone's own verbs, kept from the column that this sheet replaced.
            Not in the approved shape - flagged as a deliberate carry-over,
            because dropping the row would take `end room` with it and strand
            rooms with no way to close them from a pocket. That is a capability
            loss, not a style change, so it is not mine to make silently. */}
        <VerbChips branch={branch} scope={scope} />

        <p className="baud-agent-closer">tap outside to close</p>
      </section>
    </div>
  );
}

