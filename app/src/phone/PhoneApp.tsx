/**
 * BAUD as a wheel - the phone face (FPLAN-0413 phase 3, read depth in 3b, the
 * rail in FPLAN-0423, the rail made permanent in FPLAN-0424).
 *
 * ONE LAYOUT, NOT TWO. The rail sits above the terminal at all times and the
 * region below it shows either an attached room or the resting state. This
 * REVOKES the hide-the-rail-in-a-room state I designed into the approved
 * mockup: live use falsified it in a day. Patrick, verbatim: "I have to detach
 * every time I want to observe agents. the terminal is the center piece, always
 * there just like desktop, I can navigate as agents are working." A shape can be
 * approved and still be wrong; the thumb that approved it is the same thumb that
 * revoked it, and that is the correct order.
 *
 * BROWSING IS NOT SWITCHING. Flicking the rail moves the notch, the current
 * strip and the expand target - and touches NOTHING else. It never closes the
 * socket, never opens one, never types. Switching rooms is one explicit act:
 * attach from an expanded card. This mirrors the desk, where clicking another
 * agent's room switches the tab and the cards stay where they were.
 *
 * THE COLUMN IS GONE AND THAT IS THE POINT. Seventeen cards stacked vertically
 * was a scroll-to-find, which is the opposite of what a fleet screen is for:
 * knowing at a glance who is awake. Patrick voted on a horizontal wheel from a
 * live mockup on his own phone and locked it in one round, so the rail is the
 * fleet now, the centred chip is the CURRENT agent, and everything
 * context-bound follows it. The cards, the reads and the verbs did not go
 * anywhere - they moved into the sheet that a tap on the centre opens.
 *
 * This is the payoff of the transport seam. Every card below is the SAME
 * `BranchChip` the desktop renders, reading the same 18 fields, coloured by
 * the same design tokens. Nothing here reimplements the fleet; it re-seats it.
 * The only thing that changed underneath is which transport `host/index.ts`
 * was built against.
 *
 * READS ARE NOT VERBS - the correction that phase 3b exists for. The first cut
 * wired every card callback to a handler that threw, so the face showed all
 * seventeen agents and did nothing at all (Patrick's review, verbatim: "it
 * shows all agents but zero function"). Opening a file and reading a diff were
 * never verbs; they are exactly what @api's read lane serves. Now the figures
 * on each card open the file they came from, the read row opens the rest, and
 * only the true verbs - launch, shell, settings, end room - stay withdrawn.
 *
 * ALIVENESS COMES FROM ONE FIELD. The lamp is driven by the card's own
 * `dispatched`/`interactive`, exactly as on the desktop, and the session list
 * is shown as its own line rather than joined into the cards. `has_room` means
 * a room EXISTS, not that anyone is in it - deriving a green light from it
 * would ship the lie the m12 badge work existed to kill.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { agentRoster, baudSettingsRead, fleetSnapshot, listProjects, notificationsRead } from "../host";
import { HostError, writeToken } from "../host/transport.http";
import type {
  BaudSettings,
  BranchStatus,
  FleetSnapshot,
  NotificationEvent,
  ProjectListing,
} from "../types";
// The two gears are the DESKTOP'S OWN panels, mounted as-is: their host calls
// go through this build's http transport, and their `baud-settings-*` styling
// lives in theme.css, which this face already imports. Two settings screens
// drifting apart over one file is exactly the bug this avoids.
import AgentSettings from "../components/AgentSettings";
import InterfaceSettings from "../components/InterfaceSettings";
import AgentSheet from "./AgentSheet";
import FeedScreen from "./FeedScreen";
import FilesScreen from "./FilesScreen";
import FleetWheel, { cardRef } from "./FleetWheel";
import MonitorSheet from "./MonitorSheet";
import PassportSheet from "./PassportSheet";
import Reader, { type ReadTarget } from "./Reader";
import TerminalSheet from "./TerminalSheet";
import { LockChip } from "./VerbChips";
import type { PhoneMode } from "./rooms";
import { PHONE_VERBS, type Scope, scopeRefusal } from "./verbs";

/** The desktop's own middle cadence. A phone on cellular does not want 2s. */
const POLL_MS = 10_000;

/** How far the operator has read the feed. Per PROJECT, exactly as the desktop
 *  bell keys it: another project's feed is another history, and its unread
 *  count is not this one's news. */
const READ_KEY = (project: string) => `baud-phone-feed-read:${project}`;

/** Where the phone keeps its seat. The server holds no seat for this face -
 *  the chosen project rides every read as a parameter instead, so two phones
 *  (or a phone and a curl) can look at two projects through one server. */
const PROJECT_KEY = "baud-phone-project";

/** One open pane in the stage: an agent room, an empty shell, a watch, or a
 *  file view. Files joined the row on Patrick's call (08-16: "when i select a
 *  file to view. it should open to a tab. and tabs can just stack for multi
 *  files") - a file is an observer, exactly what tabs are reserved for. */
interface OpenPane {
  /** Branch name; empty ONLY for the project-root shell. */
  name: string;
  mode: PhoneMode | "file";
  /** File panes only: `<branch>/<relative>` - the pane's identity AND its
   *  read request, names-never-paths as everywhere on this face. */
  ref?: string;
  /** Which project the pane's branch lives in. Empty means the seat, which is
   *  what every pane meant before browsing went free. */
  project?: string;
  /**
   * THE CARD AS IT WAS WHEN THIS PANE OPENED - and the pane's ONLY source of
   * it, ever again.
   *
   * This field exists because its absence was a live bug. Every pane used to
   * re-resolve its card by NAME out of the seated project's poll list on every
   * render; switching the header made that lookup miss, the pane rendered a
   * resting line instead of its sheet, and unmounting a sheet closes its
   * socket. Patrick: "I can change project and the terminal drops your chat.
   * nothing changes the terminal agent except my hands."
   *
   * The desktop never had this bug and the reason is structural, not careful:
   * its `<Terminal>` is mounted once with NO branch prop and holds its own room
   * internally, so there is no lookup to miss. This is that model inside the
   * phone's tab architecture - the snapshot is taken once, at the moment the
   * operator opens the pane, and the live poll is never consulted for it again.
   * Absent only where no card exists: the project-root shell and the global
   * watch, which are requests for a place rather than for an agent.
   */
  card?: BranchStatus;
}

/**
 * One pane per ROOM, not per door. An agent room is keyed by branch - resume vs
 * fresh is a choice made at open time, not a second room - while a shell and a
 * watch on the same branch are genuinely different panes (three different
 * processes on the host). The desktop keys its tabs the same way.
 *
 * EVERY KEY IS PROJECT-QUALIFIED, and that is not decoration. The host names a
 * room `baud-<project>-<branch>` and a shell `baud-shell-<project>-<branch>`:
 * the project is part of the room's identity on the host, so a key that omits
 * it describes a room that does not exist. It cost nothing while the face could
 * only reach one project. The moment browsing went free it became live: two
 * projects can hold a same-named agent, and an unqualified key makes the second
 * one look ALREADY OPEN - so attaching it would quietly focus the first one's
 * pane instead, and the operator would be typing to the wrong agent under the
 * right name. The root shell is the worst of them, since `@project` was the
 * same string for every project on the machine.
 *
 * WITH ONE EXCEPTION, and it is the same exception the whole face makes: the
 * target-less watch. Global mission control names no branch AND no project on
 * the wire - @api's route ignores the project outright when no target is given
 * - so a key that qualified it by seat would describe two panes where the host
 * has one view, and flicking the header between projects would stack identical
 * monitors. A key must name what the host names, which here is nothing.
 */
function paneKey(pane: OpenPane): string {
  const where = pane.project ?? "";
  if (pane.mode === "shell") return `shell:${where}/${pane.name || "@project"}`;
  if (pane.mode === "watch") return pane.name ? `watch:${where}/${pane.name}` : "watch:@fleet";
  if (pane.mode === "file") return `file:${where}/${pane.ref}`;
  return `room:${where}/${pane.name}`;
}

/** An agent room, as opposed to the observers (shells, watches, files). */
function isSeat(pane: OpenPane): boolean {
  return pane.mode !== "shell" && pane.mode !== "watch" && pane.mode !== "file";
}

/** What the pane's tab says - short enough for a thumb-width chip. */
function paneLabel(pane: OpenPane, seatName: string): string {
  if (pane.mode === "shell") return `❯ ${pane.name || seatName}`;
  if (pane.mode === "watch") return pane.name ? `watch ${pane.name}` : "mission control";
  // The file's own name; the pane header carries the full <branch>/<path>,
  // so two same-named files in different dirs stay tellable apart.
  if (pane.mode === "file") return pane.ref?.split("/").pop() ?? "file";
  return pane.name;
}

/**
 * The seat selector, phone shape. Same contract as the desktop's
 * ProjectSwitch - the rows are the backend's own census, chosen by NAME, and
 * this component never sees or sends a path - but picking a row sets CLIENT
 * state rather than switching a server seat.
 */
function ProjectPick({ current, onPick }: { current: string; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProjectListing[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setRows(null);
    setFailure(null);
    try {
      setRows(await listProjects());
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="baud-phone-projectpick">
      <button
        type="button"
        className="baud-phone-project"
        title="switch project"
        onClick={() => void toggle()}
      >
        {current}
        <span className="baud-phone-project-caret">▾</span>
      </button>
      {open ? (
        <>
          {/* A tap anywhere else closes the menu - the phone's click-away. */}
          <div className="baud-phone-project-away" onClick={() => setOpen(false)} />
          <div className="baud-phone-project-menu" role="menu">
            {failure ? <div className="baud-phone-project-fail">{failure}</div> : null}
            {rows === null && !failure ? (
              <div className="baud-phone-project-fail">scanning…</div>
            ) : null}
            {(rows ?? []).map((entry) => (
              <button
                key={entry.root}
                type="button"
                role="menuitem"
                className={`baud-phone-project-item ${
                  entry.name === current ? "baud-phone-project-item-active" : ""
                }`}
                onClick={() => {
                  setOpen(false);
                  onPick(entry.name);
                }}
              >
                <span className="baud-phone-project-item-name">{entry.name}</span>
                {entry.anchor ? <span className="baud-phone-project-tag">anchor</span> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

interface PhoneAppProps {
  /** The token's own label, from `/v1/whoami` - who this face is connected as. */
  label: string;
  /**
   * What this token may do, from `/v1/whoami`. It does not decide whether the
   * chips EXIST - only whether they fire or answer with their reason.
   */
  scope: Scope;
  /** Operator signed out: forget the token and go back to the door. */
  onSignOut: () => void;
}

export default function PhoneApp({ label, scope, onSignOut }: PhoneAppProps) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The phone's seat: a census NAME, "" meaning the anchor. Survives a
   *  reload via localStorage; the server never holds it. */
  const [project, setProject] = useState<string>(
    () => window.localStorage.getItem(PROJECT_KEY) ?? "",
  );
  const [reading, setReading] = useState<ReadTarget | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  /**
   * THE BELL COUNTS WHILE THE FEED IS SHUT, which is the only time a badge is
   * worth anything. FeedScreen polls its own cursor lane, but it mounts on open
   * and unmounts on close - so nothing was counting during the entire period
   * the number is for, and the bell was a bare glyph with no state at all.
   *
   * This is the desktop Bell's model, lifted a level: poll the feed, hold the
   * marker for how far the operator has read, and badge the difference. ISO
   * timestamps compare as strings, so the marker needs no Date parsing to
   * disagree with the feed's own ordering.
   *
   * WHERE IT DIVERGES FROM THE DESK, deliberately: the desktop's shade is a
   * glance with an explicit CLEAR button beside it. The phone's feed is a
   * full-height screen you leave to get back to anything, so LEAVING is the
   * read - the marker moves on close, never on open, so nothing can be marked
   * read while it is still arriving behind the screen you are looking at.
   */
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [readUpTo, setReadUpTo] = useState("");
  /** Whose file browser is open - branch AND project, because browsing is free
   *  across projects since 2026-08-16 and a name alone would resolve under the
   *  seat. Null means none. */
  const [browsing, setBrowsing] = useState<{ name: string; project: string } | null>(null);
  /**
   * EVERY OPEN PANE, not one. Patrick, first session with shells and watches:
   * "I have to detach the shell and attach again to get back to u... watch,
   * shell and ur terminal should be available without disturbing." So the
   * stage holds tabs now, the desktop's own answer: every open pane stays
   * MOUNTED with its socket alive, and switching is visibility, not
   * lifecycle. A room keeps its bytes flowing while a shell is on top.
   * Held as names + modes, never cards, for the freshest-poll reason above.
   */
  const [open, setOpen] = useState<OpenPane[]>([]);
  /** Which pane is showing, by paneKey. The rest stay live underneath. */
  const [active, setActive] = useState<string | null>(null);
  /** Which branch's claude-settings panel is open. Null means none. */
  const [settingsAgent, setSettingsAgent] = useState<string | null>(null);
  /** The header gear - BAUD's own settings for the machine's seat. */
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  /**
   * BAUD's document, held so the interface panel opens on the truth instead
   * of flashing defaults. The phone runs on none of these prefs (its poll
   * cadence is its own, above) - this is the file's mirror, not config.
   */
  const [baudSettings, setBaudSettings] = useState<BaudSettings | null>(null);
  useEffect(() => {
    baudSettingsRead()
      .then(setBaudSettings)
      // A failed read is not a blank document; the panel re-reads on open
      // and carries its own error line, so nothing is invented here.
      .catch(() => setBaudSettings(null));
  }, []);
  /**
   * The card under the notch as `PROJECT/name`. The face's "where am I".
   *
   * A REF, NOT A NAME, since the rail learned to cross projects: eleven
   * projects share a naming convention, so a bare name can address two
   * different agents and the lookup would silently prefer the seated one.
   */
  const [centered, setCentered] = useState<string | null>(null);
  /**
   * The cross-project working set for the live and dispatched wheels, and the
   * reason it is missing when it is.
   *
   * A SECOND LANE, not a second copy of the fleet read: `baud --roster` is one
   * sweep over every project, which is why the wheels do not fan out over the
   * census (eleven projects would be eleven fleet reads per poll). Null is a
   * refusal, never an empty system.
   */
  const [roster, setRoster] = useState<BranchStatus[] | null>(null);
  const [rosterRefusal, setRosterRefusal] = useState<{ line: string; detail: string } | null>(null);
  /** The centred card, opened. Null while the rail is just being flicked. */
  const [expanded, setExpanded] = useState<string | null>(null);
  /**
   * Whose passport is open, by REF - `project/name`, the same key the wheel
   * and the expanded card use.
   *
   * The ref AND the card as it was at the click, which is the desk's own shape
   * (`App.tsx`: `{ name, project, held }`), and both halves earn their place.
   * The REF is looked up live every render, because the poll hands down a fresh
   * object every tick and a passport pinned to the click is frozen - the
   * sub-agent count on this document has to be able to move while it is read.
   * The HELD copy is what the lookup falls back to, and it is what makes this
   * document survive a project switch: the same species of bug that dropped the
   * terminal lived here too, one modal instead of one socket. Project-qualified,
   * so two projects with a same-named agent can never hand it the wrong one.
   */
  const [passportOf, setPassportOf] = useState<{ ref: string; held: BranchStatus } | null>(null);
  /**
   * Is the operator typing INTO the room right now?
   *
   * The one piece of the persistent layout that has to give. Rail plus a room
   * plus chips plus a soft keyboard does not fit on a phone, and the thing that
   * must not shrink is the terminal - it is the centrepiece and it is what the
   * typing is aimed at. So the rail COMPACTS while the compose field has focus:
   * names and notch drop, the avatars shrink, the strip and footer go. The rail
   * itself never leaves - the amendment revoked hiding it, and a keyboard is not
   * a reason to break that. Card WIDTH is deliberately untouched, so the snap
   * geometry does not move and the centred card cannot drift under the operator
   * while the keyboard opens.
   */
  const [typing, setTyping] = useState(false);

  const poll = useCallback(async () => {
    try {
      const next = await fleetSnapshot(project || undefined);
      setSnapshot(next);
      // The envelope carries its own failure. A snapshot that read nothing is
      // not an empty fleet, and the sentence is BAUD's own - show it verbatim.
      setError(next.error ?? null);
    } catch (cause) {
      if (cause instanceof HostError && cause.unauthorized) {
        // The token stopped working while we were using it. Do not sit on a
        // stale fleet pretending it is current.
        writeToken(null);
        onSignOut();
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }

    // The roster rides the SAME tick but its own failure. A host without the
    // route yet is a healthy host with two wheels missing, and it must not put
    // an error banner over a fleet read that worked perfectly.
    try {
      setRoster(await agentRoster());
      setRosterRefusal(null);
    } catch (cause) {
      setRoster(null);
      // A 404 here is the ROUTE not existing yet, which is a schedule, not a
      // fault - so it gets the calm word and keeps the whole reason one
      // long-press away. Anything else is a real failure and says so in the
      // host's own words.
      setRosterRefusal(
        cause instanceof HostError && cause.status === 404
          ? {
              line: "lane pending",
              detail:
                "the host serves one project per read - the cross-project roster route is not live yet",
            }
          : {
              line: "roster unavailable",
              detail: cause instanceof Error ? cause.message : String(cause),
            },
      );
    }
  }, [onSignOut, project]);

  useEffect(() => {
    // `project` is a dependency through `poll`, so picking a row refetches
    // immediately - the wheel re-seats without waiting out the interval.
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  /** Pick a seat. The name is a census key and travels verbatim. */
  const pickProject = useCallback((name: string) => {
    setProject(name);
    window.localStorage.setItem(PROJECT_KEY, name);
  }, []);

  /** Open a pane, or bring the already-open one forward - doors, not
   *  toggles, the desktop's own re-click rule. An agent room is one pane per
   *  branch regardless of which launch door was pressed: the launch mode is a
   *  choice made at open time, not a second room.
   *
   *  ONE AGENT SEAT, Patrick's design (08-16, first night living with tabs):
   *  "tabs without tabs - it is so flawless to move between agents via resume
   *  or attach... no multi tab agent setup, multi tab agents are a nightmare
   *  to manage." Attaching an agent REPLACES the agent already in the seat -
   *  the swap IS the navigation, and the replaced room survives on the host
   *  because unmounting is a detach. Tabs are reserved for the OBSERVERS -
   *  shells and watches - which is what lets him chat with one agent while
   *  watching others. Nineteen agent chips was the failure mode this rules
   *  out; the wheel is the agent switcher, not the tab row. */
  const focusPane = useCallback((pane: OpenPane) => {
    const key = paneKey(pane);
    setOpen((current) => {
      if (current.some((held) => paneKey(held) === key)) return current;
      if (isSeat(pane)) {
        const seat = current.findIndex(isSeat);
        if (seat !== -1) {
          // Swap in place: the chip keeps its slot, the old client detaches.
          const next = [...current];
          next[seat] = pane;
          return next;
        }
      }
      return [...current, pane];
    });
    setActive(key);
  }, []);

  /** Close one pane. Rooms and shells survive on the host (the close is a
   *  detach); a watch's observer dies with it, which is a watch's contract. */
  const closePane = useCallback(
    (key: string) => {
      setOpen((current) => current.filter((held) => paneKey(held) !== key));
      setActive((now) => {
        if (now !== key) return now;
        const rest = open.filter((held) => paneKey(held) !== key);
        return rest.length ? paneKey(rest[rest.length - 1]) : null;
      });
    },
    [open],
  );

  /* The seat's own marker, re-read when the seat changes - and the events with
     it, because a stale list against a fresh marker would badge the wrong
     project's news for one poll. */
  useEffect(() => {
    setReadUpTo(window.localStorage.getItem(READ_KEY(project)) ?? "");
    setEvents([]);
  }, [project]);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      notificationsRead()
        .then((next) => {
          if (mounted) setEvents(next);
        })
        .catch(() => {
          /* A failed poll keeps the last good list. The badge never invents
             events, and the next tick retries anyway. */
        });
    };
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [project]);

  const unread = readUpTo ? events.filter((event) => event.ts > readUpTo).length : events.length;

  /** Closing the feed IS the read. */
  const closeFeed = useCallback(() => {
    setFeedOpen(false);
    setEvents((seen) => {
      const newest = seen.length > 0 ? seen[seen.length - 1].ts : "";
      if (newest) {
        setReadUpTo(newest);
        window.localStorage.setItem(READ_KEY(project), newest);
      }
      return seen;
    });
  }, [project]);

  const branches = snapshot?.branches ?? [];
  const live = snapshot?.live_agent_sessions ?? [];
  /**
   * Both resolved by NAME against the latest poll, never held as objects. A
   * card captured when the rail stopped moving would be ten seconds stale by
   * the time it is opened, and would show a dead agent as live.
   */
  //
  // RESOLVED OUT OF BOTH CENSUSES, seated read first. A card centred on the
  // live or dispatched wheel may live in another project entirely and is
  // simply not in `branches` - looking there alone would hand back a
  // same-named local agent, which is the exact confusion the ref exists to
  // prevent. Seated first so an agent present in both is the local object.
  const pool = roster ? [...branches, ...roster] : branches;
  const current = pool.find((card) => cardRef(card) === centered) ?? branches[0];
  const expandedCard = expanded ? pool.find((card) => cardRef(card) === expanded) : undefined;
  // Looked up EVERY render, never held - see `passportOf`. The document follows
  // the poll, so a sub-agent that starts while the passport is open shows up.
  const passportCard = passportOf
    ? (pool.find((card) => cardRef(card) === passportOf.ref) ?? passportOf.held)
    : undefined;

  /**
   * What a MANAGER runs - the desk's two global monitors, relocated into the
   * passport exactly as Round A relocated them off the desk's top bar.
   *
   * BOTH ARE LIVE NOW. The mission-control door shipped DISABLED last round
   * because the host's watch lane could only express a branch monitor; @api
   * built the target-less shape the same evening, and the door it was reported
   * for is the door that opened. It was worth more shut than pointed at the
   * `prax` BRANCH, which was a valid target sitting right there and would have
   * rendered perfectly while being a different view entirely.
   *
   *  - PRAX MISSION CONTROL is the desk's target-LESS monitor: `drone @prax
   *    monitor run` with nothing after it, every branch at once. On the wire
   *    that is `kind=watch` with NO branch - measured against their handler,
   *    not inferred: an absent branch and an empty one are the same value to
   *    the route, and `if branch:` is what chooses global over per-branch.
   *  - COMMONS is `drone @prax monitor run commons`, the same lane with a
   *    target their contract names by keyword.
   *
   * BOTH RIDE THE SEAT, never the passport's project. A watch is anchor
   * tooling - the host refuses an external one outright, because @prax monitors
   * the repo it lives in - so a manager card browsed from another project opens
   * THIS seat's monitors, which is what those monitors are.
   */
  const managerMonitors = useMemo(() => {
    if (!passportCard?.manager) return [];
    const seat = snapshot?.project ?? "";
    const commonsCard = branches.find((card) => card.name === "commons");
    return [
      {
        id: "monitor:prax",
        label: "prax",
        hint: "open prax mission control - a read-only live view of every branch",
        // The empty NAME is the request for the global monitor, the same way
        // the project-root shell asks for a room with no branch. The stand-in
        // carries the two fields a watch reads.
        // The passport closes first: what it opens is a pane BELOW it, and a
        // monitor nobody can see because a document is over it is a door that
        // appears not to work. Every other door on this face does the same.
        open: () => {
          setPassportOf(null);
          focusPane({ name: "", mode: "watch", project: seat });
        },
      },
      {
        id: "monitor:commons",
        label: "commons",
        hint: commonsCard
          ? "open the commons live feed - posts, comments, votes, read-only"
          : "the commons feed opens through the commons card, and this seat has none",
        open: commonsCard
          ? () => {
              setPassportOf(null);
              focusPane({ name: commonsCard.name, mode: "watch", project: seat, card: commonsCard });
            }
          : null,
      },
    ];
  }, [passportCard, branches, snapshot, focusPane]);

  /* THE SELF-CLOSING EFFECT IS GONE, and its reason with it. It existed
     because a ref alone could point at nothing: the document vanished on the
     poll that dropped the card and would REAPPEAR on a later poll that brought
     it back, which is a modal nobody can explain. Falling back to the held copy
     removes the vanishing, so there is nothing left to reappear from - and the
     passport now survives a project switch, which the closing version did not.
     It closes on one gesture: the operator's. */

  const activePane = open.find((pane) => paneKey(pane) === active) ?? null;
  return (
    <div className={`baud-phone ${typing ? "baud-phone-typing" : ""}`}>
      <header className="baud-phone-head">
        <span className="baud-phone-title">BAUD</span>
        {/* The name shown is the SNAPSHOT's own project - what is actually on
            the wheel - not the stored choice, so a refused or misspelled seat
            can never dress itself as the thing it failed to become. */}
        <ProjectPick current={snapshot?.project ?? (project || "—")} onPick={pickProject} />
        {/* The desktop header's own shell button, same glyph: an empty
            terminal at the SELECTED project's root. Its own tmux room
            (`baud-shell-<project>`), so it survives a screen lock exactly the
            way agent rooms do - a phone terminal that dies with the lock
            button would be furniture. */}
        <button
          type="button"
          className="baud-phone-feedbutton baud-phone-shellbutton"
          title={`open a shell at ${snapshot?.project ?? "the project"}'s root — its own room, detach-safe`}
          onClick={() => focusPane({ name: "", mode: "shell", project: snapshot?.project ?? project })}
        >
          ❯_
        </button>
        {/* The desktop header's bell, same paths, same stroke idiom - an emoji
            here read as a sticker on a terminal (Patrick: "uggggg"). */}
        <button
          type="button"
          className={`baud-phone-feedbutton ${unread > 0 ? "baud-phone-feedbutton-alert" : ""}`}
          title={unread > 0 ? `feed — ${unread} unread` : "feed"}
          onClick={() => setFeedOpen(true)}
        >
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
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {/* Capped at 99+ like the desk's: the badge is a "how much", and past
              two digits it stops being one and starts breaking the header. */}
          {unread > 0 ? (
            <span className="baud-phone-feedbadge">{unread > 99 ? "99+" : unread}</span>
          ) : null}
        </button>
        {/* The desktop header's gear, same paths - BAUD's own settings plus
            the hooks sound switch, through /v1 instead of a Tauri command. */}
        <button
          type="button"
          className="baud-phone-feedbutton"
          title="BAUD settings - startup agent, poll cadence, bell behaviour, hook sounds"
          onClick={() => setInterfaceOpen(true)}
        >
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
        </button>
        {/* One machine, one lock chip - not one per card. */}
        <LockChip scope={scope} />
        <button type="button" className="baud-phone-signout" onClick={onSignOut} title={`connected as ${label}`}>
          sign out
        </button>
      </header>

      {error ? <p className="baud-phone-error">{error}</p> : null}

      {/* THE WHEEL. One flick reaches the whole fleet, and the notch names a
          current agent - which is the thing the desktop has no need for and a
          phone cannot do without. */}
      <FleetWheel
        branches={branches}
        roster={roster}
        rosterRefusal={rosterRefusal}
        seatedProject={snapshot?.project ?? ""}
        centered={current ? cardRef(current) : null}
        attached={activePane?.name ?? null}
        onCenter={setCentered}
        onExpand={setExpanded}
      />

      {/* THE CURRENT-AGENT STRIP IS GONE. Patrick, on a screenshot with three
          visible terminal lines: "u see no room for the terminal... all agent
          info goes in the card." He is right and it was duplication: the rail's
          dots and badges are the at-a-glance layer, the expanded card is the
          detail layer, and the strip was a third copy standing between them
          paying rent in the one dimension the terminal needs. Nothing was lost -
          every figure it showed is a door on the card. */}
      {branches.length === 0 ? (
        <p className="baud-phone-empty">{error ? "" : "reading the fleet…"}</p>
      ) : null}

      {/* THE STAGE - the terminal's permanent place under the rail.
          Patrick, after living with the hide-state: "the terminal is the center
          piece, always there just like desktop, I can navigate as agents are
          working." So this region never goes away; only its CONTENTS change,
          between an attached room and the resting state. Fleet view and room
          view stopped being two layouts. */}
      {/* THE TAB ROW - the stage's own switcher, shown only when something is
          open. Every chip is a live pane; the ✕ is the one close affordance
          that works for all three kinds (and the only one the project-root
          shell has, since it owns no card). */}
      {open.length > 0 ? (
        <nav className="baud-phone-panes">
          {open.map((pane) => {
            const key = paneKey(pane);
            return (
              <span
                key={key}
                className={`baud-phone-panetab ${key === active ? "baud-phone-panetab-active" : ""}`}
              >
                <button
                  type="button"
                  className="baud-phone-panetab-name"
                  onClick={() => setActive(key)}
                >
                  {paneLabel(pane, snapshot?.project ?? "project")}
                </button>
                <button
                  type="button"
                  className="baud-phone-panetab-close"
                  title="close this pane — rooms and shells survive on the host; a watch or file view just ends"
                  onClick={() => closePane(key)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </nav>
      ) : null}

      <section className="baud-phone-stage">
        {/* EVERY OPEN PANE STAYS MOUNTED - switching is visibility, never
            lifecycle. An unmount closes that pane's socket, so hiding with
            `visibility` (not display:none) is load-bearing twice over: the
            hidden pane keeps its real size, so no resize ever fires from a
            pane nobody is looking at - a display:none pane would measure 0x0
            and, through `window-size smallest`, SHRINK THE SHARED ROOM under
            the desk and every other client. The panes are keyed, so flipping
            the active one re-renders nothing underneath. */}
        {open.map((pane) => {
          const key = paneKey(pane);
          /* THE POLL IS NOT CONSULTED HERE, and that line's absence is the fix.
             `branches.find(held => held.name === pane.name)` used to sit on this
             line: a re-resolution by NAME, every render, against the SEATED
             project's list. Switching the header replaced that list, the lookup
             missed, the pane fell through to a resting line, and unmounting the
             sheet closed its socket - so browsing dropped the chat. A pane's
             lifecycle now depends on nothing that can change underneath it. */
          const held = pane.card;
          return (
            <div
              key={key}
              className={`baud-phone-pane ${key === active ? "" : "baud-phone-pane-hidden"}`}
            >
              {pane.mode === "file" ? (
                /* The SAME Reader that overlays for card reads, re-seated as
                   tab content - phone.css unpins its fixed/fullscreen shape
                   inside a pane. Its `‹ back` and the tab's ✕ agree: close. */
                <Reader
                  target={{
                    ref: pane.ref ?? "",
                    title: pane.ref ?? "",
                    kind: "file",
                    project: pane.project,
                  }}
                  onClose={() => closePane(key)}
                />
              ) : pane.mode === "watch" ? (
                /* NO BRANCH IS A REAL ANSWER HERE, and only here. Everywhere
                   else on this face an absent branch is a bug; a target-less
                   watch is global mission control - the desktop's own default
                   pane - and it names no session to take over. The stand-in
                   carries the two fields a watch reads, exactly as the
                   project-root shell's does. */
                !pane.name ? (
                  <MonitorSheet
                    branch={
                      {
                        name: "",
                        path: "",
                        project: pane.project ?? snapshot?.project ?? "",
                        interactive: true,
                      } as BranchStatus
                    }
                  />
                ) : (
                  /* The pane's OWN card, never the poll's. A watch whose branch
                     has left the current read is still a live observer with a
                     process behind it; dropping it because a list changed would
                     kill something the operator never asked to close. */
                  <MonitorSheet branch={held ?? ({ name: pane.name, path: "", project: pane.project ?? "" } as BranchStatus)} />
                )
              ) : (
                /* ALWAYS A SHEET. There is no "this branch left the read" arm
                   any more, because that arm was the bug: a room drops its
                   client only on the operator's own three gestures - the
                   attach swap, end room, and the tab's close. A list changing
                   is none of them. */
                <TerminalSheet
                  branch={
                    /* The project-root shell has NO card - the fleet does not
                       list the project as a branch of itself. The stand-in
                       carries the two fields a shell reads: the empty name
                       (the request for the root) and the project. */
                    held ??
                    ({
                      name: pane.name,
                      path: "",
                      project: pane.project || snapshot?.project || "",
                      interactive: true,
                    } as BranchStatus)
                  }
                  mode={pane.mode}
                  scope={scope}
                  onComposeFocus={setTyping}
                />
              )}
            </div>
          );
        })}
        {open.length === 0 ? (
          <div className="baud-phone-resting">
            <p className="baud-phone-resting-line">no room attached</p>
            {/* The aliveness line lives HERE now, because it is a fleet fact and
                this is the fleet's resting state. With a room open the terminal
                header names where you are and the rail's dots carry the rest. */}
            <p className="baud-phone-resting-live">
              {live.length ? `live: ${live.join(", ")}` : "no live agent sessions"}
            </p>
            <p className="baud-phone-resting-hint">
              open one from a card — rooms, shells, watches and files stack here as tabs
            </p>
          </div>
        ) : null}
      </section>

      {expandedCard ? (
        <AgentSheet
          branch={expandedCard}
          seatedProject={snapshot?.project ?? ""}
          scope={scope}
          onRead={(ref, title, kind) => {
            setExpanded(null);
            // The card's OWN project, not the seat - the read is fenced on the
            // address it names, and naming half an address is how a foreign
            // agent's file becomes a local agent's file.
            setReading({ ref, title, kind, project: expandedCard.project });
          }}
          onFiles={() => {
            setExpanded(null);
            setBrowsing({ name: expandedCard.name, project: expandedCard.project });
          }}
          onShell={() => {
            setExpanded(null);
            focusPane({ name: expandedCard.name, mode: "shell", project: expandedCard.project, card: expandedCard });
          }}
          onWatch={() => {
            setExpanded(null);
            focusPane({ name: expandedCard.name, mode: "watch", project: expandedCard.project, card: expandedCard });
          }}
          onSettings={() => {
            setExpanded(null);
            setSettingsAgent(expandedCard.name);
          }}
          onPassport={() => {
            setExpanded(null);
            setPassportOf({ ref: cardRef(expandedCard), held: expandedCard });
          }}
          onAttach={(mode) => {
            setExpanded(null);
            focusPane({ name: expandedCard.name, mode, project: expandedCard.project, card: expandedCard });
          }}
          /* Built by paneKey itself rather than spelled out here - a key
             written in two places drifts the first time its shape changes,
             and it just did. */
          isAttachedRoom={open.some(
            (pane) =>
              paneKey(pane) ===
              paneKey({ name: expandedCard.name, mode: "resume", project: expandedCard.project }),
          )}
          onDetach={() => {
            setExpanded(null);
            closePane(paneKey({ name: expandedCard.name, mode: "resume", project: expandedCard.project }));
          }}
          onClose={() => setExpanded(null)}
        />
      ) : null}

      {/* THE PASSPORT (transfer round). It outranks the agent sheet in z-order
          and replaces it on open - a document you read, over the menu you
          reached it from. If the card leaves the fleet while it is open the
          sheet closes itself rather than standing on a stale copy. */}
      {passportCard ? (
        <PassportSheet
          branch={passportCard}
          monitors={managerMonitors}
          onClose={() => setPassportOf(null)}
        />
      ) : null}

      {/* THE TWO GEARS - the desktop's own components, unmodified. Their scrim
          and panel styling ride theme.css; every read and write goes through
          the same /v1 settings routes the desktop's semantics were ported to,
          so a dial saved here and a dial saved at the desk land in one file. */}
      {settingsAgent ? (
        <AgentSettings agent={settingsAgent} onClose={() => setSettingsAgent(null)} />
      ) : null}
      {interfaceOpen ? (
        <InterfaceSettings
          agents={branches.map((card) => card.name)}
          settings={baudSettings ?? {}}
          onSaved={setBaudSettings}
          onClose={() => setInterfaceOpen(false)}
        />
      ) : null}

      {/* READS ARE OVERLAYS, NOT DESTINATIONS - and under the persistent layout
          that stopped being a nicety. These used to be early returns, which
          unmounted this whole tree: opening a README while attached would have
          torn down the terminal and closed the room's socket, so "observing
          never requires detaching" would have been false through the one door
          the operator uses most. Rendered on top, the room below keeps running
          and keeps receiving bytes while a file is being read. */}
      {/* The browser renders BEFORE the reader so a tapped file's Reader sits
          on top of the level it came from, and `‹ back` lands you back in it. */}
      {/* A tapped file opens as a TAB, not an overlay (Patrick, 08-16): the
          browser closes so the file is immediately in view, and each further
          pick stacks another tab - multi-file is the tab row doing its job.
          Re-tapping an already-open file fronts its existing tab. */}
      {browsing ? (
        <FilesScreen
          branch={browsing.name}
          project={browsing.project}
          onOpenFile={(ref) => {
            const from = browsing;
            setBrowsing(null);
            focusPane({ name: from.name, mode: "file", ref, project: from.project });
          }}
          onClose={() => setBrowsing(null)}
        />
      ) : null}
      {reading ? <Reader target={reading} onClose={() => setReading(null)} /> : null}
      {feedOpen ? <FeedScreen pollMs={POLL_MS} onClose={closeFeed} /> : null}

      {/* The footer states what this SESSION is, not what the build can do.
          Same bundle, two sentences - the scope is the difference.
          IT STANDS DOWN WHILE A ROOM IS OPEN. Not asked for, flagged as mine:
          the round is about giving the terminal its rows back, this is a
          standing status line, and the head's lock chip already carries the
          scope permanently. It returns in the resting state where there is
          nothing competing for the space. */}
      {open.length ? null : (
        <footer className="baud-phone-foot">
          {scopeRefusal(scope)
            ? `read-only mirror · ${PHONE_VERBS.length + 1} verbs present, all refused — ${scope} scope`
            : `operate session · ${PHONE_VERBS.length + 1} verbs live`}
        </footer>
      )}
    </div>
  );
}
