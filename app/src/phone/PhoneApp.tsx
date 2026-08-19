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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { baudSettingsRead, listProjects } from "../host";
import type { BaudSettings, BranchStatus, ProjectListing } from "../types";
// The two gears are the DESKTOP'S OWN panels, mounted as-is: their host calls
// go through this build's http transport, and their `baud-settings-*` styling
// lives in theme.css, which this face already imports. Two settings screens
// drifting apart over one file is exactly the bug this avoids.
//
// THE HEADER GEAR NOW OPENS `PhoneSettings` FIRST, one screen in front of the
// desk's interface panel - which it then mounts UNMODIFIED, so the sentence
// above still holds in full. The screen exists because this face gained a
// preference the desk does not have (terminal scroll speed, a thumb's problem);
// see the header of PhoneSettings.tsx for why that became a screen rather than
// a row in the shared panel or a second gear in this header.
import AgentSettings from "../desktop/AgentSettings";
// `interfacePrefs` comes with the panel and is not re-derived here: it is the
// one place absence or a hand-edited nonsense value becomes a default
// (InterfaceSettings.tsx:56), and a second reading of `startup_agent` would be
// a second chance for the two faces to disagree about what the file says.
import { interfacePrefs } from "../desktop/InterfaceSettings";
import AgentSheet from "./AgentSheet";
import { ARTIFACTS_DIR, isCertificateOpen, renderCertificate } from "./Certificate";
import FeedScreen from "./FeedScreen";
import FilesScreen from "./FilesScreen";
import RootsScreen from "./RootsScreen";
import FleetWheel, { cardRef, openingCard } from "./FleetWheel";
import GitApp from "./git/GitApp";
import MemoryScreen from "./MemoryScreen";
import MonitorSheet from "./MonitorSheet";
import PassportSheet from "./PassportSheet";
import PhoneSettings, { scrollPercent } from "./PhoneSettings";
import Reader, { type ReadTarget } from "./Reader";
import TerminalSheet from "./TerminalSheet";
import { LockChip } from "./VerbChips";
import { roomEnded } from "../intent";
// THE FOUR POLLING LANES, and the three constants the render still names.
// They left this file in FPLAN-0445 without changing a line of what they do -
// see the header of pollers.ts for why the ORDER of the hook calls below is
// part of the contract and not a matter of taste.
import {
  CLEARED_KEY,
  POLL_MS,
  READ_KEY,
  useFeedBadge,
  useFleetPoll,
  useGitSweep,
  useRepoCount,
} from "./lib/pollers";
import { type PhoneMode, helpCommand, roomDoors } from "./lib/rooms";
import { PHONE_VERBS, type Scope, scopeRefusal } from "./lib/verbs";

/** Where the phone keeps its seat. The server holds no seat for this face -
 *  the chosen project rides every read as a parameter instead, so two phones
 *  (or a phone and a curl) can look at two projects through one server. */
const PROJECT_KEY = "baud-phone-project";

/**
 * THE STARTUP AGENT'S ONE SHOT, spent for this PAGE LOAD.
 *
 * Patrick, 08-17: "In baud settings I have devpulse set as the default startup
 * agent. On desktop when I open baud, devpulse is there waiting... Phone does
 * not do this - when I refresh, devpulse doesn't reload/seat."
 *
 * A MODULE VARIABLE, NOT `intent.ts`'s `sessionStorage` SHOT, and the store is
 * the whole difference between the two faces. The desk spends its shot in
 * `sessionStorage` because its "app run" outlives a React remount: `npm run
 * tauri dev` IS the operator's seat, so every frontend save hot-reloads App and
 * a ref-held guard would re-arm and resurrect a room the operator just ended
 * (intent.ts, Patrick-caught 18:27). None of that is true here. The phone ships
 * a built bundle with no HMR, and its refresh is a TAB RELOAD - which
 * `sessionStorage` deliberately SURVIVES. Borrowing the desk's store would have
 * armed the shot exactly once per tab, ever, and left the second refresh in
 * precisely the state this round exists to fix. Module scope dies with the page
 * load, which is what "once per open, every open" actually means in a browser.
 *
 * Not a ref for the same reason it is not state: signing out and back in
 * remounts PhoneApp, and a token change mid-session is not a fresh arrival -
 * the pane lifecycle changes by HANDS from there on.
 */
let startupSpent = false;

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
  /**
   * FILE PANES ONLY: which KIND of word `ref`'s first component is - `home`,
   * `project`, `aipass`, or `branch` (FPLAN-0443). Absent is the branch
   * meaning every file pane had before the roots roster existed.
   *
   * PART OF `paneKey`, unlike `document` - and for the opposite reason. The
   * key is the file's IDENTITY, and the same spelling under two roots is two
   * different files: `README.md` in the home directory and `README.md` in the
   * AIPass checkout are not one document seen twice. A key that dropped the
   * root would front the wrong tab and show a stranger's file under a name the
   * operator recognised.
   */
  root?: string;
  /** Which project the pane's branch lives in. Empty means the seat, which is
   *  what every pane meant before browsing went free. */
  project?: string;
  /**
   * FILE PANES ONLY, and set at the moment of the tap: this file is a known
   * DOCUMENT and should be drawn rather than printed.
   *
   * It rides the pane rather than being re-derived at render time because the
   * question it answers is "which door opened this" - the passport's records
   * door, floored at `artifacts` - and that fact exists only while the browse
   * that opened it exists. Absent on every other file, which is all of them
   * but one: no flag, no designed render, the Reader prints the text.
   *
   * NOT PART OF `paneKey`, deliberately. The key is the file's identity and
   * one file is one tab; a key that carried the render would stack a second
   * tab on the same path and let the operator hold two views of one file that
   * could disagree.
   */
  document?: "certificate";
  /**
   * SHELL PANES ONLY, and set at the moment of the tap: one command line to
   * type into this shell when it opens. The card's `?` sends the branch's help
   * line; the `shell` doors send nothing and hand over a bare prompt.
   *
   * The desktop's own field, same name and same job (`App.tsx:56`: "What an
   * inquiry shell types on open - absent is a bare prompt").
   *
   * NOT PART OF `paneKey`, for the same reason `document` is not: the key is
   * the ROOM's identity, and `?` and `shell` open the one room the host names
   * `baud-shell-<project>-<branch>`. A key that carried this would describe two
   * panes where the host has one session - two tmux clients on it, fighting
   * over the window size through `window-size smallest`.
   */
  command?: string;
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
  // The root joins the key because it is part of the file's identity - see
  // `OpenPane.root`. Absent stays absent in the string, so every file pane
  // opened before roots existed keys exactly as it did.
  if (pane.mode === "file") return `file:${pane.root ?? ""}:${where}/${pane.ref}`;
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
  /**
   * Whether `scope` above is the SERVER's answer yet or still its safe default.
   * Only the startup seat reads it - see the note on it in `main.tsx`. Every
   * other consumer is right to treat all three flavours of "read" alike.
   */
  scopeKnown: boolean;
  /** Operator signed out: forget the token and go back to the door. */
  onSignOut: () => void;
}

export default function PhoneApp({ label, scope, scopeKnown, onSignOut }: PhoneAppProps) {
  /** The phone's seat: a census NAME, "" meaning the anchor. Survives a
   *  reload via localStorage; the server never holds it. */
  const [project, setProject] = useState<string>(
    () => window.localStorage.getItem(PROJECT_KEY) ?? "",
  );
  const [reading, setReading] = useState<ReadTarget | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  /** Whose file browser is open - branch AND project, because browsing is free
   *  across projects since 2026-08-16 and a name alone would resolve under the
   *  seat. `start` is the floor: "" for the files door, `artifacts` for the
   *  passport's records door (compass #291). Null means none. */
  const [browsing, setBrowsing] = useState<{
    name: string;
    project: string;
    start: string;
    /** Which KIND of word `name` is, when the browse came off the roots
     *  roster (FPLAN-0443). Absent for every door that names a citizen, which
     *  is every door that existed before it. */
    root?: string;
  } | null>(null);
  /** THE FILES APP's first screen - the roster of places to stand. A boolean
   *  because the roster IS the app's front door: picking a row opens a browse
   *  and closes this, so there is never a second thing to remember. */
  const [rootsOpen, setRootsOpen] = useState(false);
  /** Whose working memory is open - the card's `memory` door (compass #291).
   *  By NAME and PROJECT, the same address every read on this face takes. */
  const [memoryOf, setMemoryOf] = useState<{ name: string; project: string } | null>(null);
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
  /**
   * Has a seat already been taken by HANDS? The desk's own `seatedRef`
   * (App.tsx:144) and held for its reason: it is only ever read at the one
   * moment the startup shot is spent, so it never has to survive anything. The
   * SHOT itself is not here - see the module note on `startupSpent`.
   */
  const seatedRef = useRef(false);
  /** Which branch's claude-settings panel is open. Null means none. */
  const [settingsAgent, setSettingsAgent] = useState<string | null>(null);
  /** The header gear - BAUD's own settings for the machine's seat. */
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  /**
   * BAUD's document, held so the settings panel opens on the truth instead of
   * flashing defaults - and, for two keys now, so the face can RUN on it.
   *
   * It began as the file's mirror and nothing more. `startup_agent` made it
   * config, and `terminal_scroll_percent` makes it live config: the pane below
   * re-reads this on every render, so a save (or the read the panel does on
   * open) reaches an attached room without a reattach. The poll cadence is
   * still the one pref the phone does NOT take from here - its own is above,
   * and a phone on cellular does not want the desk's.
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

  /* THE FOUR POLLING LANES LIVE IN `lib/pollers.ts` (FPLAN-0445). Each hook
     is called exactly where its effect used to be declared, because React runs
     effects in declaration order and that order is load-bearing here. */
  const { snapshot, error, roster, rosterRefusal } = useFleetPoll(project, onSignOut);

  const gitCounts = useGitSweep(snapshot);

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
    // A seat taken is a seat taken, whoever took it - and an operator who has
    // already picked one outranks the startup preference (App.tsx:382, the same
    // line inside the desk's own launch door). Observers do not count: a shell,
    // a watch or a file is not the seat the preference is about.
    if (isSeat(pane)) seatedRef.current = true;
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

  /**
   * THE STARTUP AGENT, on the phone (DPLAN-0302). The desk's own effect
   * (App.tsx:424-440), mirrored guard for guard, through this face's doors.
   *
   * ONCE PER PAGE LOAD, as soon as the first fleet read AND the settings
   * document have both landed: the named agent's room is opened as the SEAT,
   * through `focusPane` - the very call the expanded card's attach door makes
   * (`onAttach`), with the same pane shape, the same project qualification and
   * the same held card. There is no second path into a room here and this one
   * does not invent one; the operator arrives exactly where a tap would have
   * put them, which is what "devpulse is there waiting" means.
   *
   * THE SHOT IS SPENT WHATEVER HAPPENS, before a single outcome is judged. That
   * is what keeps this initialization rather than a poll consequence: `snapshot`
   * is a dependency and it changes every ten seconds, a project switch changes
   * it too, and NONE of those may open a pane. Panes change by hands from the
   * moment this effect has had its one look. The desk spends it on the same
   * line and for the same reason.
   *
   * WAITING FOR ALL THREE READS IS THE POINT. A settings document that has not
   * arrived is not an empty one, a fleet that has not answered is not a fleet
   * without the agent in it, and a scope nobody has asked for yet is not a read
   * token - firing on any of those guesses would open the wrong thing, or open
   * nothing at all and call it a preference. `scopeKnown` is the third and it is
   * the one that was nearly missed: the fleet read ALWAYS lands before whoami
   * here, so without it this effect would have refused itself on every single
   * load while looking perfectly reasonable in review (main.tsx carries the
   * measurement).
   */
  useEffect(() => {
    if (!snapshot || !baudSettings || !scopeKnown || startupSpent) return;
    startupSpent = true;
    const startupAgent = interfacePrefs(baudSettings).startupAgent;
    if (!startupAgent || seatedRef.current) return;
    /* THE SCOPE, which the desk has no half of - it holds the machine, not a
       bearer token. An attached room is a shell prompt with the operator's
       credentials at it, so @api demands operate for it and serves read only to
       a watch (server.py:979). A read-scoped session would therefore get a pane
       that exists solely to print its own refusal, unasked - and TerminalSheet's
       refusal line is honest precisely because a HAND opened that door and is
       owed the reason. Nobody asked for this one, so it does not open; the
       reason still reaches the operator the moment they tap a card, and the
       lock chip in the header already says which token this is. */
    const refusal = scopeRefusal(scope);
    if (refusal) {
      console.info(`startup agent '${startupAgent}' stays closed - ${refusal}`);
      return;
    }
    const branch = snapshot.branches.find((item) => item.name === startupAgent);
    if (!branch) {
      // The desk's own sentence and its own judgment: an agent that has no card
      // in the seated project is not a fault worth a banner over.
      console.warn(`startup agent '${startupAgent}' has no card here - opening nothing`);
      return;
    }
    /* THE ENDED-ROOM RULING (intent.ts, Patrick 2026-08-12): a room the operator
       ended stays dead until they open its card themselves. Read here, and it is
       worth saying plainly that TODAY IT IS ALWAYS FALSE ON THIS FACE - the mark
       lives in localStorage per origin, and nothing on the phone writes it: the
       `end room` verb kills the session and records nothing. This is the guard
       standing ready, not a doctrine already kept. It costs one import, and it
       means the day the phone's kill door learns to mark its rooms, the startup
       seat cannot resurrect one - which is the exact bug the desk already paid
       for once. The gap itself is reported, not patched here. */
    if (roomEnded(snapshot.project, branch.name)) {
      console.info(
        `startup agent '${branch.name}' stays closed - you ended its room; open its card to bring it back`,
      );
      return;
    }
    /* Which door a tap would have taken, from the card's own judgment - a live
       session ATTACHES and types nothing, history or a dispatch transcript
       RESUMES, anything else starts fresh. `roomDoors(branch)[0]` IS that
       judgment (rooms.ts), and a live room returns exactly one door, so the
       first is the only one. Deliberately not a second copy of the desk's
       `cardMode`: the two agree line for line today, and the way they stop
       agreeing is by being written twice. */
    focusPane({
      name: branch.name,
      mode: roomDoors(branch)[0].mode,
      project: branch.project,
      card: branch,
    });
  }, [snapshot, baudSettings, scope, scopeKnown, focusPane]);

  const { events, setEvents, readUpTo, setReadUpTo, clearedUpTo, setClearedUpTo } =
    useFeedBadge(project);

  /* The LATER of the two markers is the floor: a cleared event is read by
     definition, and a read event that was never cleared still renders. Taking
     the max keeps the badge and the feed screen filtering on the same line. */
  const floor = readUpTo > clearedUpTo ? readUpTo : clearedUpTo;
  const unread = floor ? events.filter((event) => event.ts > floor).length : events.length;

  /** The operator cleared what was on screen. DISPLAY ONLY - the marker moves,
   *  the feed file does not, exactly as the desktop bell has always done it. */
  const clearFeed = useCallback(
    (upTo: string) => {
      setClearedUpTo(upTo);
      window.localStorage.setItem(CLEARED_KEY(project), upTo);
    },
    [project],
  );

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
  /* THE UNCHOSEN CARD IS THE MANAGER, not `branches[0]` - the same rule the rail
     itself opens on, through the same function, because these two saying
     different things is a notch marking one card while the ring glows on
     another. The window where it shows is small (the rail reports its real
     centre a frame later) and it is exactly the window a cold load and a project
     switch live in, which is the whole of what was asked for. */
  const current =
    pool.find((card) => cardRef(card) === centered) ??
    openingCard(branches, snapshot?.project ?? "");
  const expandedCard = expanded ? pool.find((card) => cardRef(card) === expanded) : undefined;
  // Looked up EVERY render, never held - see `passportOf`. The document follows
  // the poll, so a sub-agent that starts while the passport is open shows up.
  const passportCard = passportOf
    ? (pool.find((card) => cardRef(card) === passportOf.ref) ?? passportOf.held)
    : undefined;

  /* --------------------------------------------------------- the git app -- */

  /** The seat as the SERVER named it, which is what every read is addressed
   *  with - `project` above is what the operator picked, and the anchor's is
   *  "" on the way out and a real name on the way back. */
  const seat = snapshot?.project ?? "";
  /**
   * WHICH CITIZEN NAMES THE REPOSITORY, and why the git app takes one at all.
   *
   * Every read the app makes is repo-grain, so the branch is an address for a
   * TREE and nothing about that branch is ever shown. The host resolves a
   * branch to a directory and walks up to the repository above it, which is
   * what makes a nested project (projects/baud carries its own marker) answer
   * about itself rather than about the fleet repo it sits inside.
   *
   * THE MANAGER, through the same function the rail opens on. It is the one
   * citizen every project has and the one that cannot be a temporary spawn, so
   * the app's answer does not move when the wheel does - which matters
   * precisely because the apps layer is where the rail is NOT pointing at an
   * agent. `openingCard` falls back to the first card, and to nothing at all
   * before the first read lands; the app says so rather than asking with "".
   */
  const repoCitizen = openingCard(branches, seat)?.name ?? "";
  const repoCounts = useRepoCount(repoCitizen, seat);

  /** The app cards' badges, by card key. One entry today; the shape is the
   *  wheel's, so a second app is a second key and no new plumbing. */
  const appBadges = useMemo(() => ({ git: repoCounts[seat] }), [repoCounts, seat]);
  /** Is the git app open. A boolean, not a screen name: the app owns its own
   *  stack of screens, so this face only knows whether it is showing. */
  const [gitOpen, setGitOpen] = useState(false);
  /**
   * WHOSE CHANGES ARE OPEN - the agent card's GIT tile (Patrick, 08-17).
   *
   * The same component as the app above, at branch grain, and a SECOND state
   * rather than a mode on `gitOpen` because the two doors carry different
   * things: this one has a subject, and the subject is not the seat. Name and
   * project both, for the reason every read on this face carries both - eleven
   * projects share a naming convention, so half an address finds a same-named
   * local agent's tree and shows it as this one's.
   *
   * `ref` is the CARD to come back to. Every other door on this face closes the
   * card and lands on the wheel, and this one is deliberately different: the
   * tile opens a detail OF that card, so leaving it should put the card back
   * rather than making the operator find it on the rail again.
   */
  const [gitOf, setGitOf] = useState<{ name: string; project: string; ref: string } | null>(null);

  /**
   * What a MANAGER runs - the desk's two global monitors, on the AGENT CARD
   * since compass #291.
   *
   * They spent a round living inside the passport, which put two live doors
   * inside an identity document; the ruling is that the passport carries
   * nothing operational, so they moved to the card's MANAGER zone. The doors
   * themselves are untouched - same targets, same read-only contract, same
   * refusal when this face has no route.
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
   * BOTH RIDE THE SEAT, never the card's project. A watch is anchor tooling -
   * the host refuses an external one outright, because @prax monitors the repo
   * it lives in - so a manager card browsed from another project opens THIS
   * seat's monitors, which is what those monitors are.
   */
  const managerMonitors = useMemo(() => {
    if (!expandedCard?.manager) return [];
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
        // The card closes first: what it opens is a pane BELOW it, and a
        // monitor nobody can see because a sheet is over it is a door that
        // appears not to work. Every other door on this card does the same.
        open: () => {
          setExpanded(null);
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
              setExpanded(null);
              focusPane({ name: commonsCard.name, mode: "watch", project: seat, card: commonsCard });
            }
          : null,
      },
    ];
  }, [expandedCard, branches, snapshot, focusPane]);

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
          title="BAUD settings - terminal, interface, connection, about"
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
        gitCounts={gitCounts}
        centered={current ? cardRef(current) : null}
        attached={activePane?.name ?? null}
        appBadges={appBadges}
        onCenter={setCentered}
        onExpand={setExpanded}
        /* THE FOURTH LAYER'S DOOR. One key today and a switch would be one
           branch of nothing, so the app is opened by name - the day there are
           two, this is where the second one is named. */
        onOpenApp={(key) => {
          if (key === "git") setGitOpen(true);
          if (key === "files") setRootsOpen(true);
        }}
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
                    root: pane.root,
                  }}
                  /* THE ONE DESIGNED RENDER on this face, and it is opt-in per
                     pane: no flag, no renderer, and the Reader takes the same
                     `<pre>` path it has always taken. The renderer itself can
                     still decline - a certificate that will not parse is read
                     as the text it is. */
                  render={pane.document === "certificate" ? renderCertificate : undefined}
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
                  /* Absent on every pane but one: the shell the card's `?`
                     opened, which types the help line once and then is an
                     ordinary shell with the operator's keyboard in it. */
                  command={pane.command ?? null}
                  scope={scope}
                  /* Resolved HERE, once, and handed to every pane - so two
                     rooms open side by side can never scroll at two speeds,
                     and a save reaches all of them on the same render. */
                  scrollPercent={scrollPercent(baudSettings)}
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
          /* THE GIT TILE, which used to be an `onRead` of kind `diff` - one
             raw whole-branch patch in the plain reader. Patrick's 08-17 ruling
             replaced it with the git app's own flow at branch grain: the
             grouped list, a tap, the rendered patch. The card's OWN project
             rides along, exactly as the tile's count fetch sends it, so a
             foreign card's changes are that card's and not a same-named local
             agent's. */
          onGit={() => {
            setExpanded(null);
            setGitOf({
              name: expandedCard.name,
              project: expandedCard.project,
              ref: cardRef(expandedCard),
            });
          }}
          onFiles={() => {
            setExpanded(null);
            setBrowsing({ name: expandedCard.name, project: expandedCard.project, start: "" });
          }}
          onShell={() => {
            setExpanded(null);
            focusPane({ name: expandedCard.name, mode: "shell", project: expandedCard.project, card: expandedCard });
          }}
          /* THE `?` - the desk's `helpBranch` (App.tsx:297), which is this same
             call with a command line attached. Nothing else differs: same door
             press, same shell, same room.

             ONE ROOM MEANS ONE PANE. `paneKey` ignores `command`, so pressing
             `?` on a branch whose shell is already open brings that pane
             forward and types nothing - which is the desk's own re-click rule
             for this exact door ("Same door semantics as watch: re-click brings
             the open one forward", App.tsx:296), arriving here through the
             stricter route: the desk can afford a second help TAB because its
             shells are throwaway ptys, and this face cannot, because the phone's
             shell is a persistent tmux session that the desk and the pocket
             share. Doors, not toggles - and never two clients on one session. */
          onHelp={() => {
            setExpanded(null);
            focusPane({
              name: expandedCard.name,
              mode: "shell",
              project: expandedCard.project,
              card: expandedCard,
              command: helpCommand(expandedCard.name),
            });
          }}
          onWatch={() => {
            setExpanded(null);
            focusPane({ name: expandedCard.name, mode: "watch", project: expandedCard.project, card: expandedCard });
          }}
          onSettings={() => {
            setExpanded(null);
            setSettingsAgent(expandedCard.name);
          }}
          /* THE MEMORY DOOR (compass #291). By name and project, the same
             address the passport read takes - the screen behind it reads the
             two `.trinity` files that used to be pages of the passport. */
          onMemory={() => {
            setExpanded(null);
            setMemoryOf({ name: expandedCard.name, project: expandedCard.project });
          }}
          monitors={managerMonitors}
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
          /* The records door: the SAME browser the files door opens, floored
             at `artifacts/`. The document closes first, exactly as every other
             door on this face closes what it was reached from - what it opens
             is a full-height screen, and a screen under a document is a door
             that appears not to work. */
          onArtifacts={() => {
            setPassportOf(null);
            setBrowsing({
              name: passportCard.name,
              project: passportCard.project,
              /* The floor, from the one constant the certificate's trigger
                 tests against - spelled twice is how the door and the document
                 stop agreeing. */
              start: ARTIFACTS_DIR,
            });
          }}
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
        <PhoneSettings
          agents={branches.map((card) => card.name)}
          settings={baudSettings ?? {}}
          scope={scope}
          /* The connection screen reports the token, so it needs the one thing
             every other consumer is happy to conflate: whether the server has
             ANSWERED yet. "read" and "not asked" are the same safe thing to a
             verb chip and two different sentences on a screen about the token. */
          scopeKnown={scopeKnown}
          /* A READ lands here too, not just a save - which is what carries a
             speed written at the desk into the room already on screen. */
          onDocument={setBaudSettings}
          /* THE SAME FUNCTION THE HEADER CHIP CALLS - handed down, not rebuilt.
             The connection screen is a second door on one sign-out. */
          onSignOut={onSignOut}
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
          /* KEYED ON THE WHOLE BROWSE, floor included: the start directory is
             read once, into state, so a second browse arriving while one is
             open must be a new component rather than the old one holding the
             old floor. */
          key={`${browsing.root ?? ""}:${browsing.project}/${browsing.name}/${browsing.start}`}
          branch={browsing.name}
          project={browsing.project}
          root={browsing.root}
          start={browsing.start}
          onOpenFile={(ref) => {
            const from = browsing;
            setBrowsing(null);
            focusPane({
              name: from.name,
              mode: "file",
              ref,
              project: from.project,
              // The floor travels with the file: a read resolved against the
              // wrong root does not fail, it finds a different file.
              root: from.root,
              /* THE ONLY PLACE A DESIGNED DOCUMENT IS EVER ASKED FOR: the
                 browse floored at `artifacts` - the passport's records door -
                 tapping the one certificate at its one name. The card's files
                 door floors at "" and can never satisfy it, so every file it
                 opens, including that same certificate reached the long way
                 round, carries no flag and reads as text. */
              document: isCertificateOpen(from.name, from.start, ref) ? "certificate" : undefined,
            });
          }}
          onClose={() => setBrowsing(null)}
        />
      ) : null}
      {/* THE FILES APP - the roster first, the browser behind it. Rendered
          BEFORE the browser above for the same reason the browser renders
          before the reader: each screen sits on top of the one it came from,
          and `‹ back` lands where you were. */}
      {rootsOpen ? (
        <RootsScreen
          onPick={(root) => {
            setRootsOpen(false);
            setBrowsing({
              /* THE FIRST PATH COMPONENT. A branch and a project name
                 themselves; `home` and `aipass` name nothing, and the fence
                 resolves those from the KIND alone - so the kind stands in as
                 the component rather than leaving it empty, which would send
                 a leading slash the transport refuses by design. One
                 expression, one place: nothing downstream has to know which
                 kinds carry a name. */
              name: root.name || root.kind,
              /* NO PROJECT. The root IS the scope here - a project root names
                 its project in `name`, and home and aipass belong to the
                 machine rather than to any project. Sending the seat would ask
                 the fence to resolve a root inside a project, which is not a
                 question it has. */
              project: "",
              start: "",
              root: root.kind,
            });
          }}
          onClose={() => setRootsOpen(false)}
        />
      ) : null}
      {/* WORKING MEMORY - a screen, not an overlay on the card: it is read, at
          length, and the reader idiom is what this face uses for reading. */}
      {memoryOf ? (
        <MemoryScreen
          branch={memoryOf.name}
          project={memoryOf.project}
          onClose={() => setMemoryOf(null)}
        />
      ) : null}
      {reading ? <Reader target={reading} onClose={() => setReading(null)} /> : null}
      {/* THE GIT APP - a full-height screen over the stage, like every other
          read on this face, so the room underneath keeps its socket and its
          bytes while a diff is being read. It owns its own back stack; this
          face only says whether it is open. */}
      {gitOpen ? (
        <GitApp
          branch={repoCitizen}
          project={seat}
          projectLabel={seat || "anchor"}
          /* The measured number or NOTHING - `??` would turn "not read yet"
             into a confident zero, which is the one thing this lane may not
             say. `undefined` and `null` are the same absence here; the app's
             prop is null because a component's contract should have one. */
          changed={repoCounts[seat] ?? null}
          onClose={() => setGitOpen(false)}
        />
      ) : null}
      {/* THE SAME APP, AT BRANCH GRAIN - the card's GIT tile. It opens straight
          into the changes list and carries no `changed` or `projectLabel`,
          because both of those belong to the sheet screen this grain never
          shows. A grain, not a copy: the list, the grouping, the tap and the
          patch are one implementation, so the two doors cannot drift into two
          pictures of the same file. */}
      {gitOf ? (
        <GitApp
          /* KEYED ON THE SUBJECT. The app's back stack is state, and the floor
             it starts on is decided once at mount - so a second card's changes
             arriving while one is open must be a new component rather than the
             old one holding the old branch. The card must be closed first
             today, which is exactly the kind of "cannot happen" that stops
             being true the first time a door opens from somewhere else. */
          key={`${gitOf.project}/${gitOf.name}`}
          branch={gitOf.name}
          project={gitOf.project}
          grain="branch"
          onClose={() => {
            setGitOf(null);
            // BACK TO THE CARD IT WAS PRESSED ON - see `gitOf`. The chip on
            // that screen says `‹ card`, and this is what makes the word true.
            setExpanded(gitOf.ref);
          }}
        />
      ) : null}
      {feedOpen ? (
        <FeedScreen
          pollMs={POLL_MS}
          clearedUpTo={clearedUpTo}
          onClear={clearFeed}
          onClose={closeFeed}
        />
      ) : null}

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
