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
import { type LaunchMode, helpCommand, roomDoors } from "./rooms";
import { type Scope, scopeRefusal } from "./verbs";

/** The files behind the figures, by the names @api's fence takes. */
const MAIL_FILE = ".ai_mail.local/inbox.json";
const PLANS_FILE = "DASHBOARD.local.json";
const TODOS_FILE = ".trinity/local.json";
const README_FILE = "README.md";

/**
 * A monitor this card can open - manager-class agents only.
 *
 * Declared here rather than in the passport since compass #291: these are
 * operational doors, and operational doors live on the card.
 */
export interface SheetMonitor {
  id: string;
  label: string;
  hint: string;
  /** Absent = this face has no route for it, and the hint says which. */
  open: (() => void) | null;
}

interface AgentSheetProps {
  branch: BranchStatus;
  /**
   * The project the phone is seated in.
   *
   * A card reached from the live or dispatched wheel can live somewhere else,
   * and this is what "somewhere else" is measured against. Since the
   * one-terminal ruling it decides almost nothing: every door works on a
   * foreign card, the header's settings gear is the single exception, and this
   * value is what that one refusal names. See the fence note in the body for
   * what each retreat cost.
   */
  seatedProject: string;
  scope: Scope;
  /**
   * Open a read - the same reader the column used.
   *
   * FILES ONLY, since 08-17. The reader still knows how to fetch a whole
   * branch's patch and this card was its only caller; the GIT tile left for
   * `onGit` on Patrick's ruling, so the kind this card can ask for is narrowed
   * to the one it actually asks for. A prop that offers a mode nobody presses
   * is a door drawn on a wall.
   */
  onRead: (ref: string, title: string, kind: "file") => void;
  /**
   * Open THIS branch's changes - the GIT tile's door (Patrick, 08-17).
   *
   * A door of its own rather than a third `onRead` kind, because what it opens
   * is not a read: it is a screen with its own back stack, its own list and its
   * own per-file diff underneath it. The reader shows one thing; this shows a
   * way through several.
   */
  onGit: () => void;
  /** Open the branch's file browser - the files door, live since 08-15. */
  onFiles: () => void;
  /** Open an EMPTY terminal in this branch's directory - the desktop card's
   *  shell button. A different room than the agent's (`baud-shell-*`), so it
   *  is offered even while the agent's own room is the one on screen. */
  onShell: () => void;
  /**
   * Open that same shell with `drone @<branch> --help` already run - the
   * desktop card's `?` (BranchChip.tsx:240, App.tsx:297). Since 08-17 it wears
   * the desk's shape too: a bare `?` in the card's top-right corner.
   *
   * A SEPARATE PROP, not a parameter on `onShell`, because the card does not
   * own the sentence: WHAT gets typed is `rooms.ts`'s job and WHERE it lands is
   * the fleet's, exactly as the launch doors hand up a mode rather than a
   * command line. The card only says which door was pressed.
   */
  onHelp: () => void;
  /** Watch this branch's activity - the desktop card's monitor pane (m9),
   *  live in the stage since 08-16. Read-only by contract, both ends. */
  onWatch: () => void;
  /** Open this branch's claude settings - the desktop card's gear, and since
   *  08-17 the desk's own glyph in the desk's own corner. The panel itself is
   *  the desktop's component; only the door lives here. */
  onSettings: () => void;
  /**
   * Open this branch's WORKING MEMORY - sessions, learnings, todos,
   * observations (compass #291).
   *
   * The screen behind this door is not new work: it is the four tabs that used
   * to live inside the passport, reading the same two `.trinity` files by the
   * same named-file lane. What moved is WHERE they hang. A passport is an
   * identity document and a memory file is the agent's live workbook - the day
   * it was written is the day it changed - so the workbook belongs on the card
   * that carries every other live fact, and the document carries none.
   */
  onMemory: () => void;
  /**
   * The monitors a MANAGER runs, or empty for everyone else.
   *
   * THE CALLER DECIDES, because the caller owns the panes these doors open.
   * They lived in the passport until compass #291 and they were operational
   * doors sitting inside an identity document; they are the same two doors,
   * regrouped under a zone label on the card where doors live.
   */
  monitors: SheetMonitor[];
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
      // The tile is a door, and the door now RE-ASKS THE LANE THE TILE COUNTED.
      // It used to open the raw whole-branch patch - one unhighlighted wall of
      // text - and Patrick ruled on 08-17 that it should open "just like this
      // [the git app's changes screen] but show only the agent local changes".
      // So it opens that flow at branch grain: the same grouped list, the same
      // tap-a-file, the same rendered patch, scoped to this citizen's tree.
      //
      // THE REFUSAL GOT BETTER FOR FREE. The old door read /v1/diff, a
      // different lane that could say something else; the new one reads the
      // very lane this figure was counted from, so a branch whose count says
      // `n/a` opens a screen carrying the SAME sentence the hint carries -
      // @api's own, in both places, because it is one answer.
      hint: changes.state === "unavailable" ? changes.why : undefined,
      open: onGit,
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
        {/* THE HEADER ROW - the name, and in the corner the two doors that
            stopped being doors (Patrick, 08-17: settings and `?` become small
            icons top-right, no full work buttons for them). They are the desk's
            own two header chips, in the desk's own order and the desk's own
            glyphs (BranchChip.tsx:240-273), which is what this card has been
            porting since the day it was written.

            THE MIS-TAP OBJECTION IS ANSWERED, NOT IGNORED. An earlier round put
            the `?` in the door row precisely to keep the header clear, and the
            reason it gave was real: a second tap target INSIDE a finger-sized
            one is a mis-tap machine, which is why the passport never went on the
            wheel's avatar. But that hazard is nesting, and these are siblings -
            the name is no longer a full-width strip, the row gaps them apart,
            and each chip owns a 40px box of its own that the name's box does not
            reach into. Small ink, finger-sized target: the padding carries the
            touch, the glyph carries the meaning. */}
        <div className="baud-agent-head">
          {/* The name is the README door. The column had a row of read buttons
              and the approved shape has no room for one, but a branch's README
              is the document its own agents are told is the source of truth -
              losing the only way to reach it from a pocket would be a real
              subtraction. The title is the most obvious thing to press and it
              was doing nothing. */}
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
          {/* THE `?` (Patrick, 08-17: "we are missing in agent cards a ? symbol
              ... u hit it, a terminal opens and --help was run for that agent.
              then u can continue navigating the agent commands in the terminal.
              desktop has it already"). The desk's door, ported whole: it opens a
              shell and types one line into it, and the keyboard stays live
              afterwards because that is the entire point (InquiryPane.tsx:9 -
              "the card's help button pops a REAL shell seated in that branch
              with the agent's help already run").

              A BARE `?`, now that it is an icon rather than a chip in a row of
              worded doors - the word `help` was carried only because a lone
              glyph would have been the one door in that row not saying what it
              does, and the row is no longer where it lives. The symbol is the
              one Patrick asked for and the one the desk shows; `aria-label`
              carries the word for anyone the glyph says nothing to.

              NOT FENCED, like everything but the gear since the one-terminal
              ruling. The desk hides its `?` on a foreign or non-citizen card;
              this face does not, because the refusal is better downstream: a
              foreign agent's shell opens through @api's census exactly as its
              `shell` door does, and a branch with no drone address gets drone's
              own sentence printed in the terminal it just opened. A live
              accurate refusal beats a guess at the door. */}
          <button
            type="button"
            className="baud-agent-chip"
            title={`open ${branch.name}'s shell with '${helpCommand(branch.name)}' already run — and keep typing`}
            aria-label="help"
            onClick={onHelp}
          >
            <span className="baud-agent-chip-face">?</span>
          </button>
          {/* THE GEAR, and it sits OUTERMOST because it is the heavier door -
              everything else on this card reads or attaches, and this one
              WRITES a branch's claude config. The corner is where the desk keeps
              it too.

              THE ONE FENCED DOOR ON THE CARD, and the fence survives the move
              intact: its route takes a branch and no project, so on a foreign
              card it would open the SEATED project's same-named agent while the
              header named the other one. Disabled in the face's own idiom
              (dashed, still legible) and carrying the refusal as its title, with
              the sentence above spelling it out in full - because a title is a
              desk affordance and this is a phone. Never a silent no-op tap.

              An inline SVG, not `⚙`. The emoji was tried on this face once and
              read as a sticker on a terminal (Patrick: "uggggg"); these are the
              same paths the phone's own header gear draws, so the two gears an
              operator meets are one gear. */}
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
        {/* NAME, CLASS, MODE - and nothing else (compass #291). The card's
            summary string used to ride here too ("1 opened, 24 active plans,
            10 todos"), which was the counter row below written out in prose:
            the same four facts, in a second place, in a different order, with
            no way to press them. One home per fact - the tiles are the home,
            because they are the ones that open what they count. */}
        <p className="baud-agent-sub">
          {kind} · <span className={isAwake(branch) ? "baud-agent-awake" : ""}>{state}</span>
        </p>
        {/* SUB-AGENTS, and it belongs HERE rather than in the counter row
            below, which was the other candidate. Every tile in that row is a
            DOOR - press MAIL and the inbox opens, press GIT and this branch's
            changes do.
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
        {/* NOT a refusal - a fact about WHERE, plus the single door that is
            still shut. The terminal is one seat and goes where it is pointed, so
            saying "lives in VERA-STUDIO" and stopping there would read as a wall
            that is no longer standing.

            IT NAMES THE GEAR, AND NOW IT POINTS AT IT. This line carried the
            whole fence back when settings was a worded button in the row below
            and a dashed chip reading `settings` said its own name. An icon
            cannot: a dashed circle in a corner is a control that has gone quiet,
            not a control that has explained itself. So the word stays here and
            the sentence says where the quiet one is - the title is the desk's
            affordance, and this is a phone. */}
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
          {/* THE WORK DOORS - attach or detach, files, shell, watch, memory, and
              only those. `? help` and `settings` left this row on 08-17 for the
              two chips in the header (Patrick's ruling): one is a shortcut into
              the shell already offered two buttons down and the other is
              configuration rather than work, so neither was earning a
              full-width chip standing beside `attach` and `watch`. The row's
              parity is unchanged in kind - it wraps two-up and a lone last door
              takes the width, exactly as it did when there were seven. */}
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
          {/* WORKING MEMORY (compass #291): sessions, learnings, todos,
              observations - the four tabs that used to be pages of the
              passport. Same two files, same named-file lane, new door: a
              memory file is the agent's live workbook and belongs beside the
              other live doors, not inside a document that is supposed to say
              only who this agent IS. */}
          <button
            type="button"
            className="baud-agent-door"
            title={`${branch.name}'s working memory - sessions, learnings, todos, observations`}
            onClick={onMemory}
          >
            memory
          </button>
        </nav>

        {/* THE MANAGER ZONE (compass #291). These two doors are the desk's
            global monitors and they spent a round living in the passport,
            which made an identity document the place you went to start a live
            view. They are unchanged - same targets, same read-only contract,
            same refusal when this face has no route - and only regrouped:
            operational doors on the card, under a label that says who they
            belong to. Rendered only when the caller hands some over, which is
            manager-class only. */}
        {monitors.length > 0 ? (
          <section className="baud-agent-zone">
            <p className="baud-agent-zonelabel">MANAGER</p>
            <nav className="baud-agent-doors">
              {monitors.map((monitor) => (
                <button
                  key={monitor.id}
                  type="button"
                  className="baud-agent-door"
                  // A door with no route is SHOWN and refused with the reason,
                  // never hidden - the same ruling the scope-refused verbs
                  // ride. Hiding it would make an absent lane look like a
                  // feature the phone was never meant to have.
                  disabled={!monitor.open}
                  title={monitor.hint}
                  onClick={() => monitor.open?.()}
                >
                  {monitor.label}
                </button>
              ))}
            </nav>
          </section>
        ) : null}

        {/* THE IDENTITY ZONE, and it holds exactly one door. The passport is
            no longer one door among six - it is a different KIND of thing from
            the rest of this card: everything above is live and changes while
            you watch it, and behind this one is a document that only changes
            when @spawn issues something. Full width because it is the only
            thing in its zone, not for emphasis. */}
        <section className="baud-agent-zone">
          <p className="baud-agent-zonelabel">IDENTITY</p>
          <nav className="baud-agent-doors">
            {/* Fenced with the rest - the passport read goes down the same
                named-file lane every door on this card uses, so a card from
                another project refuses here exactly as it refuses everywhere
                else, in the same sentence. */}
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

