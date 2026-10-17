/** BAUD's phone face: the fleet wheel above a permanent terminal stage. Reference: docs/phone/wheel.md */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { baudSettingsRead, listProjects } from "../host";
import type { BaudSettings, BranchStatus, NewProjectResult, ProjectListing } from "../types";
// The desktop's own settings panels, mounted as-is so two settings screens cannot drift apart.
import AgentSettings from "../desktop/AgentSettings";
// Taken from the panel, not re-derived: a second reading of `startup_agent` lets the faces disagree.
import { interfacePrefs } from "../desktop/InterfaceSettings";
import AgentSheet from "./AgentSheet";
import BackupApp from "./backup/BackupApp";
import { ARTIFACTS_DIR, isCertificateOpen, renderCertificate } from "./Certificate";
import FeedScreen from "./FeedScreen";
import FilesScreen from "./FilesScreen";
import RootsScreen from "./RootsScreen";
import FleetWheel, { cardRef, openingCard } from "./FleetWheel";
import GitApp from "./git/GitApp";
import InboxScreen from "./InboxScreen";
import { isMarkdownRef } from "./lib/markdown";
import MachineSheet from "./MachineSheet";
import { renderMarkdown } from "./Markdown";
import MemoryScreen, { type MemoryTabId } from "./MemoryScreen";
import MonitorSheet from "./MonitorSheet";
import NewProjectSheet from "./NewProjectSheet";
import PassportSheet from "./PassportSheet";
import PlansScreen from "./PlansScreen";
import PhoneSettings, { scrollPercent } from "./PhoneSettings";
import Reader, { type ReadTarget } from "./Reader";
import TerminalSheet from "./TerminalSheet";
import { LockChip } from "./VerbChips";
import { clearRoomEnded, markRoomEnded, roomEnded } from "../intent";
import { writeMark } from "./lib/feedMarks";
import { POLL_MS, useFeedBadge, useFleetPoll, useGitSweep, useRepoCount } from "./lib/pollers";
import { machineFaces, useMachineVitals } from "./lib/machine";
import { bornCard, bornSeat } from "./lib/newProject";
import { type PhoneMode, helpCommand, roomDoors } from "./lib/rooms";
import { PHONE_VERBS, type Scope, scopeRefusal } from "./lib/verbs";
import { type Browse, type Stop, backWord, leave, stepBack } from "./lib/trail";
import { closeTab, focusOn, loadTabs, mergeTabs, restoreTabs, saveTabs } from "./lib/tabStore";
import { useHistoryGuard, useSystemBack } from "./lib/systemBack";

const PROJECT_KEY = "baud-phone-project";

const RELOAD_ACK_MS = 200;

/** The startup agent's one shot, spent once per page load. */
// Module scope: sessionStorage survives a tab reload, and a ref re-arms on the sign-in remount.
let startupSpent = false;

interface OpenPane {
  name: string;
  mode: PhoneMode | "file";
  /** File panes only: `<branch>/<relative>`, the pane's identity and its read request. */
  ref?: string;
  /** File panes only: the root kind of `ref`; part of `paneKey`, since one spelling under two roots is two files. */
  root?: string;
  project?: string;
  /** File panes only: draw as a known document. Not part of `paneKey`: one file is one tab. */
  document?: "certificate";
  /** File panes opened from a browse: the browse `‹ folder` reopens. Not part of `paneKey`. */
  from?: Browse;
  /** With `from`, and only ever set together with it: the trail the browse stood on. */
  fromTrail?: Stop[];
  /** Read back from storage: a reattach, so no launch line is typed. Never stored itself. */
  restored?: boolean;
  /** Shell panes only: one command typed on open. Not part of `paneKey`: the host has one session per shell. */
  command?: string;
  /** The card as it was when the pane opened, its only source: re-resolving from the poll drops the pane on a project switch. */
  card?: BranchStatus;
}

/** One pane per room, project-qualified because the host names rooms by project. */
// The target-less watch alone is unqualified: the host names no project for it.
function paneKey(pane: OpenPane): string {
  const where = pane.project ?? "";
  if (pane.mode === "shell") return `shell:${where}/${pane.name || "@project"}`;
  if (pane.mode === "watch") return pane.name ? `watch:${where}/${pane.name}` : "watch:@fleet";
  if (pane.mode === "file") return `file:${pane.root ?? ""}:${where}/${pane.ref}`;
  return `room:${where}/${pane.name}`;
}

function isSeat(pane: OpenPane): boolean {
  return pane.mode !== "shell" && pane.mode !== "watch" && pane.mode !== "file";
}

function paneLabel(pane: OpenPane, seatName: string): string {
  if (pane.mode === "shell") return `❯ ${pane.name || seatName}`;
  if (pane.mode === "watch") return pane.name ? `watch ${pane.name}` : "mission control";
  if (pane.mode === "file") return pane.ref?.split("/").pop() ?? "file";
  return pane.name;
}

/** The seat selector: picks a census NAME as client state, never a path or a server seat. */
function ProjectPick({
  current,
  onPick,
  scope,
  onNew,
}: {
  current: string;
  onPick: (name: string) => void;
  scope: Scope;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProjectListing[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setRows(null);
    setFailure(null);
    setRefused(null);
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
        <span className="baud-phone-project-name">{current}</span>
        <span className="baud-phone-project-caret">▾</span>
      </button>
      {open ? (
        <>
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
            <button
              type="button"
              role="menuitem"
              className={`baud-phone-project-item baud-phone-project-new ${
                scopeRefusal(scope) ? "baud-phone-verb-refused" : ""
              }`}
              onClick={() => {
                const refusal = scopeRefusal(scope);
                if (refusal) {
                  setRefused(`refused: ${refusal}`);
                  return;
                }
                setOpen(false);
                onNew();
              }}
            >
              + new project
            </button>
            {refused ? <div className="baud-phone-project-fail">{refused}</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

interface PhoneAppProps {
  label: string;
  /** What this token may do: whether the chips fire, not whether they exist. */
  scope: Scope;
  /** Whether `scope` is the server's answer yet; only the startup seat reads it. */
  scopeKnown: boolean;
  onSignOut: () => void;
}

export default function PhoneApp({ label, scope, scopeKnown, onSignOut }: PhoneAppProps) {
  const [project, setProject] = useState<string>(
    () => window.localStorage.getItem(PROJECT_KEY) ?? "",
  );
  const [reading, setReading] = useState<ReadTarget | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [browsing, setBrowsing] = useState<Browse | null>(null);
  const [rootsOpen, setRootsOpen] = useState(false);
  const [monitorCard, setMonitorCard] = useState<string | null>(null);
  const [memoryOf, setMemoryOf] = useState<{ name: string; project: string; tab?: MemoryTabId } | null>(
    null,
  );
  const [plansOf, setPlansOf] = useState<{ name: string; project: string } | null>(null);
  const [inboxOf, setInboxOf] = useState<{ name: string; project: string; messageId?: string } | null>(
    null,
  );
  /** Every open pane: all stay mounted with sockets alive; switching is visibility, not lifecycle. */
  const [open, setOpen] = useState<OpenPane[]>([]);
  const [active, setActive] = useState<string | null>(null);
  /** The order tabs were fronted in, oldest first; closing the front tab fronts the one before it. */
  const [focus, setFocus] = useState<string[]>([]);
  const [stored] = useState(() => loadTabs(window.localStorage, paneKey));
  // Until then nothing is saved either: an early empty save would erase the tabs being restored.
  const [tabsSettled, setTabsSettled] = useState(() => stored === null);
  const [trail, setTrail] = useState<Stop[]>([]);
  const seatedRef = useRef(false);
  const [startupNote, setStartupNote] = useState<string | null>(null);
  const [settingsAgent, setSettingsAgent] = useState<string | null>(null);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  /** BAUD's settings document; live config, read every render so a save reaches an attached room. */
  const [baudSettings, setBaudSettings] = useState<BaudSettings | null>(null);
  useEffect(() => {
    baudSettingsRead()
      .then(setBaudSettings)
      // A failed read is not a blank document; the panel re-reads on open.
      .catch(() => setBaudSettings(null));
  }, []);
  /** The card under the notch as a `project/name` ref; a bare name is ambiguous across projects. */
  const [centered, setCentered] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Whose passport is open: the ref is looked up live, `held` is the fallback that survives a project switch. */
  const [passportOf, setPassportOf] = useState<{ ref: string; held: BranchStatus } | null>(null);
  const [typing, setTyping] = useState(false);

  const [reloading, setReloading] = useState(false);

  // `cache: "reload"` defeats heuristic caching of the entry; best-effort, the reload happens regardless.
  const reloadFace = useCallback(() => {
    // Guarded, so a double-tap cannot queue two reloads or restart the flash.
    setReloading((already) => {
      if (already) return already;
      window.setTimeout(() => {
        void fetch(window.location.href, { cache: "reload", credentials: "same-origin" })
          .catch(() => undefined)
          .then(() => window.location.reload());
      }, RELOAD_ACK_MS);
      return true;
    });
  }, []);

  // The polling hooks are called in a load-bearing order: React runs effects in declaration order.
  const { snapshot, error, roster, rosterRefusal } = useFleetPoll(project, onSignOut);

  const gitCounts = useGitSweep(snapshot);

  const pickProject = useCallback((name: string) => {
    setProject(name);
    window.localStorage.setItem(PROJECT_KEY, name);
  }, []);

  const front = useCallback((key: string) => {
    setActive(key);
    setFocus((held) => focusOn(held, key));
  }, []);

  const focusPane = useCallback((pane: OpenPane) => {
    // A seat taken by any path outranks the startup preference; observers do not count.
    if (isSeat(pane)) seatedRef.current = true;
    const key = paneKey(pane);
    setOpen((current) => {
      if (current.some((held) => paneKey(held) === key)) return current;
      if (isSeat(pane)) {
        const seat = current.findIndex(isSeat);
        if (seat !== -1) {
          // One agent seat: attaching replaces the seated agent in place (unmount is a detach).
          const next = [...current];
          next[seat] = pane;
          return next;
        }
      }
      return [...current, pane];
    });
    front(key);
  }, [front]);

  /** Close one pane (rooms and shells survive on the host); fronts the previously fronted tab. */
  const closePane = useCallback(
    (key: string) => {
      const next = closeTab(open.map(paneKey), focus, active, key);
      setOpen((current) => current.filter((held) => paneKey(held) !== key));
      setActive(next.active);
      setFocus(next.focus);
    },
    [open, focus, active],
  );

  // Declared BEFORE the startup effect: a restored seat must mark `seatedRef` first.
  useEffect(() => {
    if (tabsSettled || stored === null) return;
    if (!snapshot || (roster === null && rosterRefusal === null)) return;
    const census = {
      seat: snapshot.project,
      // A read that failed is not a project with no agents: judge nothing on it.
      seated: snapshot.error ? null : snapshot.branches,
      roster,
    };
    const restored = restoreTabs(stored, census, paneKey);
    for (const line of restored.dropped) console.info(line);
    const merged = mergeTabs(restored, { open, active, focus }, paneKey, isSeat);
    if (merged.open.some(isSeat)) seatedRef.current = true;
    setOpen(merged.open);
    setActive(merged.active);
    setFocus(merged.focus);
    setTabsSettled(true);
  }, [tabsSettled, stored, snapshot, roster, rosterRefusal, open, active, focus]);

  // Saved on every change, but only once the stored row is folded in.
  useEffect(() => {
    if (!tabsSettled) return;
    saveTabs(window.localStorage, { open, active, focus });
  }, [tabsSettled, open, active, focus]);

  // Waits for fleet, settings, scopeKnown (the fleet lands before whoami) and tabsSettled; the shot
  // is spent before any outcome, so later polls and project switches never open a pane.
  useEffect(() => {
    if (!snapshot || !baudSettings || !scopeKnown || !tabsSettled || startupSpent) return;
    startupSpent = true;
    const startupAgent = interfacePrefs(baudSettings).startupAgent;
    if (!startupAgent || seatedRef.current) return;
    // A read-scoped token gets no unasked room: it would only print a refusal nobody asked for.
    const refusal = scopeRefusal(scope);
    if (refusal) {
      console.info(`startup agent '${startupAgent}' stays closed - ${refusal}`);
      setStartupNote(`startup agent ${startupAgent} not opened — ${refusal}`);
      return;
    }
    const branch = snapshot.branches.find((item) => item.name === startupAgent);
    if (!branch) {
      console.warn(`startup agent '${startupAgent}' has no card here - opening nothing`);
      setStartupNote(`startup agent ${startupAgent} not opened — it has no card in ${snapshot.project || "this project"}`);
      return;
    }
    // A room the operator ended stays dead until they open its card themselves (intent.ts).
    if (roomEnded(branch.project, branch.name)) {
      console.info(
        `startup agent '${branch.name}' stays closed - you ended its room; open its card to bring it back`,
      );
      return;
    }
    // `roomDoors(branch)[0]` is the card's own door judgment; not a second copy of the desk's `cardMode`.
    focusPane({
      name: branch.name,
      mode: roomDoors(branch)[0].mode,
      project: branch.project,
      card: branch,
    });
  }, [snapshot, baudSettings, scope, scopeKnown, tabsSettled, focusPane]);

  const { events, setEvents, readUpTo, setReadUpTo, clearedUpTo, setClearedUpTo } =
    useFeedBadge(project);

  // The later marker is the floor, so the badge and the feed screen filter alike.
  const floor = readUpTo > clearedUpTo ? readUpTo : clearedUpTo;
  const unread = floor ? events.filter((event) => event.ts > floor).length : events.length;

  const clearFeed = useCallback(
    (upTo: string) => {
      setClearedUpTo(upTo);
      // One machine-wide key: the feed is not per project.
      writeMark(window.localStorage, "cleared", upTo);
    },
    [setClearedUpTo],
  );

  /** Closing the feed IS the read - the one back on this face with a side effect. */
  const closeFeed = useCallback(() => {
    setFeedOpen(false);
    setEvents((seen) => {
      const newest = seen.length > 0 ? seen[seen.length - 1].ts : "";
      if (newest) {
        setReadUpTo(newest);
        writeMark(window.localStorage, "read", newest);
      }
      return seen;
    });
  }, [setEvents, setReadUpTo]);

  const branches = snapshot?.branches ?? [];
  const live = snapshot?.live_agent_sessions ?? [];
  // Resolved by ref against the latest poll every render, seated census first, never held.
  const pool = roster ? [...branches, ...roster] : branches;
  // The unchosen card is the manager, via the rail's own function, so notch and ring agree.
  const current =
    pool.find((card) => cardRef(card) === centered) ??
    openingCard(branches, snapshot?.project ?? "");
  const expandedCard = expanded ? pool.find((card) => cardRef(card) === expanded) : undefined;
  const passportCard = passportOf
    ? (pool.find((card) => cardRef(card) === passportOf.ref) ?? passportOf.held)
    : undefined;


  const seat = snapshot?.project ?? "";
  /** The manager names the repository, so the git app's answer does not move with the wheel. */
  const repoCitizen = openingCard(branches, seat)?.name ?? "";
  const repoCounts = useRepoCount(repoCitizen, seat);

  const appBadges = useMemo(() => ({ git: repoCounts[seat] }), [repoCounts, seat]);
  /** Which wheel layer is showing; the machine lane polls only on the monitor row. */
  const [wheelLayer, setWheelLayer] = useState<string | null>(null);
  const machine = useMachineVitals(wheelLayer === "monitor");
  const appFaces = useMemo(() => machineFaces(machine), [machine]);
  const [gitOpen, setGitOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  /** Whose branch-grain changes are open (the card's GIT tile); `ref` is the card to come back to. */
  const [gitOf, setGitOf] = useState<{ name: string; project: string; ref: string } | null>(null);

  /** A manager card's two monitors; both ride the seat, since the host refuses an external watch. */
  const managerMonitors = useMemo(() => {
    if (!expandedCard?.manager) return [];
    const seat = snapshot?.project ?? "";
    const commonsCard = branches.find((card) => card.name === "commons");
    return [
      {
        id: "monitor:prax",
        label: "prax",
        hint: "open prax mission control - a read-only live view of every branch",
        // The empty name asks for the global monitor; the card closes first so the pane is visible.
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


  const leaveFor = useCallback((stop: Stop) => setTrail((held) => leave(held, stop)), []);

  const walkBack = useCallback(() => {
    const { to, rest } = stepBack(trail);
    setTrail(rest);
    if (to === null) return;
    if (to.kind === "card") setExpanded(to.ref);
    else if (to.kind === "roots") setRootsOpen(true);
    else setPassportOf({ ref: to.ref, held: to.held });
  }, [trail]);

  const backTo = backWord(trail);

  /** Nothing open over the stage means no trail: a stale trail would misroute the next `‹`. */
  const overlayOpen =
    expanded !== null ||
    passportOf !== null ||
    settingsAgent !== null ||
    interfaceOpen ||
    browsing !== null ||
    rootsOpen ||
    monitorCard !== null ||
    memoryOf !== null ||
    plansOf !== null ||
    reading !== null ||
    gitOpen ||
    backupOpen ||
    gitOf !== null ||
    feedOpen ||
    inboxOf !== null;
  useEffect(() => {
    if (!overlayOpen && trail.length > 0) setTrail([]);
  }, [overlayOpen, trail.length]);

  /** The system Back runs the newest screen's close handler, the same one its `‹` calls. */
  useHistoryGuard();
  const closeCard = useCallback(() => setExpanded(null), []);
  const closePassport = useCallback(() => {
    setPassportOf(null);
    walkBack();
  }, [walkBack]);
  const closeAgentSettings = useCallback(() => {
    setSettingsAgent(null);
    walkBack();
  }, [walkBack]);
  const closeRoots = useCallback(() => {
    setRootsOpen(false);
    walkBack();
  }, [walkBack]);
  const closeMachine = useCallback(() => setMonitorCard(null), []);
  const closeMemory = useCallback(() => {
    setMemoryOf(null);
    walkBack();
  }, [walkBack]);
  const closePlans = useCallback(() => {
    setPlansOf(null);
    walkBack();
  }, [walkBack]);
  const closeReading = useCallback(() => {
    setReading(null);
    walkBack();
  }, [walkBack]);
  const closeBackup = useCallback(() => setBackupOpen(false), []);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const closeNewProject = useCallback(() => setNewProjectOpen(false), []);
  const onProjectBorn = useCallback(
    (result: NewProjectResult) => {
      setNewProjectOpen(false);
      pickProject(bornSeat(result));
      const card = bornCard(result);
      clearRoomEnded(card.project, card.name);
      focusPane({ name: card.name, mode: roomDoors(card)[0].mode, project: card.project, card });
    },
    [pickProject, focusPane],
  );
  useSystemBack(expanded !== null ? closeCard : null);
  useSystemBack(passportOf !== null ? closePassport : null);
  useSystemBack(settingsAgent !== null ? closeAgentSettings : null);
  useSystemBack(rootsOpen ? closeRoots : null);
  useSystemBack(monitorCard !== null ? closeMachine : null);
  useSystemBack(memoryOf !== null ? closeMemory : null);
  useSystemBack(plansOf !== null ? closePlans : null);
  useSystemBack(reading !== null ? closeReading : null);
  useSystemBack(backupOpen ? closeBackup : null);
  useSystemBack(feedOpen ? closeFeed : null);

  const leaveCard = () => {
    if (!expandedCard) return;
    setExpanded(null);
    leaveFor({ kind: "card", ref: cardRef(expandedCard) });
  };


  return (
    <div className={`baud-phone ${typing ? "baud-phone-typing" : ""}`}>
      <header className="baud-phone-head">
        {/* The name is the refresh; its hit area reaches the corner where a thumb lands. */}
        <button
          type="button"
          className={`baud-phone-title ${reloading ? "baud-phone-title-going" : ""}`}
          title="reload BAUD"
          onClick={reloadFace}
        >
          BAUD
        </button>
        {/* The snapshot's project, not the stored choice, so a refused seat never shows as taken. */}
        <ProjectPick
          current={snapshot?.project ?? (project || "—")}
          onPick={pickProject}
          scope={scope}
          onNew={() => setNewProjectOpen(true)}
        />
        <button
          type="button"
          className="baud-phone-feedbutton baud-phone-shellbutton"
          title={`open a shell at ${snapshot?.project ?? "the project"}'s root — its own room, detach-safe`}
          onClick={() => focusPane({ name: "", mode: "shell", project: snapshot?.project ?? project })}
        >
          ❯_
        </button>
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
          {unread > 0 ? (
            <span className="baud-phone-feedbadge">{unread > 99 ? "99+" : unread}</span>
          ) : null}
        </button>
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
        <LockChip scope={scope} />
        <button type="button" className="baud-phone-signout" onClick={onSignOut} title={`connected as ${label}`}>
          sign out
        </button>
      </header>

      {error ? <p className="baud-phone-error">{error}</p> : null}

      <FleetWheel
        branches={branches}
        roster={roster}
        rosterRefusal={rosterRefusal}
        seatedProject={snapshot?.project ?? ""}
        gitCounts={gitCounts}
        centered={current ? cardRef(current) : null}
        /* The ring follows the agent room, not whichever tab is in front. */
        attached={open.find(isSeat)?.name ?? null}
        appBadges={appBadges}
        appFaces={appFaces}
        onLayer={setWheelLayer}
        onCenter={setCentered}
        onExpand={setExpanded}
        onOpenApp={(key) => {
          if (key === "git") setGitOpen(true);
          if (key === "files") setRootsOpen(true);
          if (key === "backup") setBackupOpen(true);
          // Prefix-matched: the wheel owns the monitor card list.
          if (key.startsWith("mon-")) setMonitorCard(key);
        }}
      />

      {branches.length === 0 ? (
        <p className="baud-phone-empty">{error ? "" : "reading the fleet…"}</p>
      ) : null}

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
                  onClick={() => front(key)}
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
        {/* Hidden by `visibility`, never display:none: a 0x0 pane would shrink the shared tmux
            room through `window-size smallest`, and an unmount would close its socket. */}
        {open.map((pane) => {
          const key = paneKey(pane);
          /* Never re-resolved from the poll: a pane's lifecycle must not depend on the seated list. */
          const held = pane.card;
          return (
            <div
              key={key}
              className={`baud-phone-pane ${key === active ? "" : "baud-phone-pane-hidden"}`}
            >
              {pane.mode === "file" ? (
                /* Opened from a browse, `‹ folder` reopens it with its trail; otherwise back closes the tab. */
                <Reader
                  target={{
                    ref: pane.ref ?? "",
                    title: pane.ref ?? "",
                    kind: "file",
                    project: pane.project,
                    root: pane.root,
                  }}
                  render={
                    pane.document === "certificate"
                      ? renderCertificate
                      : isMarkdownRef(pane.ref ?? "")
                        ? renderMarkdown
                        : undefined
                  }
                  backLabel={pane.from ? "folder" : "back"}
                  onClose={() => {
                    const from = pane.from;
                    if (from) {
                      setBrowsing(from);
                      setTrail(pane.fromTrail ?? []);
                    } else closePane(key);
                  }}
                />
              ) : pane.mode === "watch" ? (
                /* No branch is valid only here: a target-less watch is global mission control. */
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
                  /* The pane's own card, never the poll's: a list change must not kill a live observer. */
                  <MonitorSheet branch={held ?? ({ name: pane.name, path: "", project: pane.project ?? "" } as BranchStatus)} />
                )
              ) : (
                /* Always a sheet: a room drops its client only on attach swap, end room or tab close. */
                <TerminalSheet
                  branch={
                    /* The project-root shell has no card; the stand-in carries the empty name and project. */
                    held ??
                    ({
                      name: pane.name,
                      path: "",
                      project: pane.project || snapshot?.project || "",
                      interactive: true,
                    } as BranchStatus)
                  }
                  mode={pane.mode}
                  command={pane.command ?? null}
                  scope={scope}
                  scrollPercent={scrollPercent(baudSettings)}
                  /* A tab restored after a reload is a reattach: no launch line. */
                  restored={pane.restored === true}
                  onComposeFocus={setTyping}
                />
              )}
            </div>
          );
        })}
        {open.length === 0 ? (
          <div className="baud-phone-resting">
            <p className="baud-phone-resting-line">no room attached</p>
            <p className="baud-phone-resting-live">
              {live.length ? `live: ${live.join(", ")}` : "no live agent sessions"}
            </p>
            <p className="baud-phone-resting-hint">
              open one from a card — rooms, shells, watches and files stack here as tabs
            </p>
            {startupNote ? <p className="baud-phone-resting-startup">{startupNote}</p> : null}
          </div>
        ) : null}
      </section>

      {expandedCard ? (
        /* Doors to a screen leave the card on the trail (`leaveCard`); doors to a pane just close it. */
        <AgentSheet
          branch={expandedCard}
          seatedProject={snapshot?.project ?? ""}
          scope={scope}
          onRead={(ref, title, kind) => {
            leaveCard();
            // The card's own project, not the seat: half an address reads a same-named local agent's file.
            setReading({ ref, title, kind, project: expandedCard.project });
          }}
          /* TODOS is the memory door with the todos tab in front, so `.trinity` is drawn one way. */
          onInbox={() => {
            leaveCard();
            setInboxOf({ name: expandedCard.name, project: expandedCard.project });
          }}
          onPlans={() => {
            leaveCard();
            setPlansOf({ name: expandedCard.name, project: expandedCard.project });
          }}
          onTodos={() => {
            leaveCard();
            setMemoryOf({ name: expandedCard.name, project: expandedCard.project, tab: "todos" });
          }}
          /* The card's own project rides along, so a foreign card's changes are its own. */
          onGit={() => {
            setExpanded(null);
            setGitOf({
              name: expandedCard.name,
              project: expandedCard.project,
              ref: cardRef(expandedCard),
            });
          }}
          onFiles={() => {
            leaveCard();
            setBrowsing({ name: expandedCard.name, project: expandedCard.project, start: "" });
          }}
          onShell={() => {
            setExpanded(null);
            focusPane({ name: expandedCard.name, mode: "shell", project: expandedCard.project, card: expandedCard });
          }}
          /* `paneKey` ignores `command`, so an already-open shell is fronted and nothing is typed:
             never two clients on one tmux session. */
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
            leaveCard();
            setSettingsAgent(expandedCard.name);
          }}
          onMemory={() => {
            leaveCard();
            setMemoryOf({ name: expandedCard.name, project: expandedCard.project });
          }}
          monitors={managerMonitors}
          onPassport={() => {
            leaveCard();
            setPassportOf({ ref: cardRef(expandedCard), held: expandedCard });
          }}
          onAttach={(mode) => {
            setExpanded(null);
            // The one door that revives an ended room (intent.ts).
            clearRoomEnded(expandedCard.project, expandedCard.name);
            focusPane({ name: expandedCard.name, mode, project: expandedCard.project, card: expandedCard });
          }}
          isAttachedRoom={open.some(
            (pane) =>
              paneKey(pane) ===
              paneKey({ name: expandedCard.name, mode: "resume", project: expandedCard.project }),
          )}
          onDetach={() => {
            setExpanded(null);
            closePane(paneKey({ name: expandedCard.name, mode: "resume", project: expandedCard.project }));
          }}
          /* Closes only the resume pane (the shell is a separate session); the sheet stays open
             because the chip shows the machine's confirmation inline. */
          onEnded={() => {
            // The startup guard reads this mark; called only after the machine confirmed the kill.
            markRoomEnded(expandedCard.project, expandedCard.name);
            closePane(paneKey({ name: expandedCard.name, mode: "resume", project: expandedCard.project }));
          }}
          onClose={closeCard}
        />
      ) : null}

      {passportCard ? (
        <PassportSheet
          branch={passportCard}
          /* The records door: the files browser floored at `artifacts/`; the document closes first. */
          onArtifacts={() => {
            setPassportOf(null);
            leaveFor({ kind: "passport", ref: cardRef(passportCard), held: passportCard });
            setBrowsing({
              name: passportCard.name,
              project: passportCard.project,
              /* The certificate trigger's own constant, so door and document agree. */
              start: ARTIFACTS_DIR,
            });
          }}
          onClose={closePassport}
        />
      ) : null}

      {/* The desktop's own settings panel, through the same /v1 routes, so both faces write one file. */}
      {settingsAgent ? (
        <AgentSettings agent={settingsAgent} closeGlyph="×" onClose={closeAgentSettings} />
      ) : null}
      {interfaceOpen ? (
        <PhoneSettings
          agents={branches.map((card) => card.name)}
          settings={baudSettings ?? {}}
          scope={scope}
          /* The connection screen must tell "not asked yet" from "read". */
          scopeKnown={scopeKnown}
          /* A read lands here too, carrying a desk-side save into the open room. */
          onDocument={setBaudSettings}
          onSignOut={onSignOut}
          onClose={() => setInterfaceOpen(false)}
        />
      ) : null}

      {/* Reads are overlays, never early returns: unmounting the tree would close the room's socket.
          A tapped file becomes a tab whose pane keeps the browse and trail for `‹ folder`. */}
      {browsing ? (
        <FilesScreen
          /* Keyed on the whole browse: the start directory is read once into state. */
          key={`${browsing.root ?? ""}:${browsing.project}/${browsing.name}/${browsing.start}@${browsing.at ?? ""}`}
          branch={browsing.name}
          project={browsing.project}
          root={browsing.root}
          start={browsing.start}
          at={browsing.at}
          backLabel={backTo}
          onOpenFile={(ref, _title, at) => {
            const from = browsing;
            const under = trail;
            setBrowsing(null);
            setTrail([]);
            focusPane({
              name: from.name,
              mode: "file",
              ref,
              project: from.project,
              // The floor travels with the file: a read resolved against the
              // wrong root does not fail, it finds a different file.
              root: from.root,
              /* Only the artifacts-floored browse ever asks for a designed document. */
              document: isCertificateOpen(from.name, from.start, ref) ? "certificate" : undefined,
              from: { ...from, at },
              fromTrail: under,
            });
          }}
          onClose={() => {
            setBrowsing(null);
            walkBack();
          }}
        />
      ) : null}
      {/* The roster and the browser are never open together; a pick leaves the roster on the trail. */}
      {rootsOpen ? (
        <RootsScreen
          onPick={(root) => {
            setRootsOpen(false);
            leaveFor({ kind: "roots" });
            setBrowsing({
              /* home and aipass name nothing, so the kind stands in: an empty component is a refused leading slash. */
              name: root.name || root.kind,
              project: "",
              start: "",
              root: root.kind,
            });
          }}
          onClose={closeRoots}
        />
      ) : null}

      {/* "Machine", not "monitor": MonitorSheet is the watch pane. */}
      {monitorCard ? (
        <MachineSheet card={monitorCard} read={machine} onClose={closeMachine} />
      ) : null}
      {memoryOf ? (
        <MemoryScreen
          /* Keyed on the tab too: the tab in front is read once, at mount. */
          key={`${memoryOf.project}/${memoryOf.name}/${memoryOf.tab ?? ""}`}
          branch={memoryOf.name}
          project={memoryOf.project}
          initialTab={memoryOf.tab}
          backLabel={backTo}
          onClose={closeMemory}
        />
      ) : null}
      {plansOf ? (
        <PlansScreen
          branch={plansOf.name}
          project={plansOf.project}
          backLabel={backTo}
          onClose={closePlans}
        />
      ) : null}
      {reading ? (
        <Reader
          target={reading}
          render={isMarkdownRef(reading.ref) ? renderMarkdown : undefined}
          backLabel={backTo}
          onClose={closeReading}
        />
      ) : null}
      {gitOpen ? (
        <GitApp
          branch={repoCitizen}
          project={seat}
          projectLabel={seat || "anchor"}
          /* With no snapshot, an empty card list means "not read yet". */
          fleetAnswered={snapshot !== null}
          /* Null, never `??` a zero: "not read yet" must not read as no changes. */
          changed={repoCounts[seat] ?? null}
          onClose={() => setGitOpen(false)}
        />
      ) : null}
      {/* Keyed on the seat so a seat change never shows one project's runs under another's name. */}
      {backupOpen ? (
        <BackupApp key={seat} project={seat} scope={scope} onClose={closeBackup} />
      ) : null}
      {newProjectOpen ? <NewProjectSheet onClose={closeNewProject} onCreated={onProjectBorn} /> : null}
      {gitOf ? (
        <GitApp
          /* Keyed on the subject: the app's floor is decided once at mount. */
          key={`${gitOf.project}/${gitOf.name}`}
          branch={gitOf.name}
          project={gitOf.project}
          grain="branch"
          onClose={() => {
            setGitOf(null);
            // Back to the card it was pressed on, which makes the `‹ card` chip true.
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
          /* The event's own project when it carries one, else the census then the roster;
             a wrong guess is safe, since the message is matched by id. */
          onOpenMail={(recipient, mailId, project) => {
            const where = project ?? pool.find((each) => each.name === recipient)?.project ?? "";
            setInboxOf({ name: recipient, project: where, messageId: mailId });
          }}
        />
      ) : null}
      {/* After the feed: a message opened off the bell sits on the feed, which stays mounted. */}
      {inboxOf ? (
        <InboxScreen
          key={`${inboxOf.project}/${inboxOf.name}/${inboxOf.messageId ?? ""}`}
          branch={inboxOf.name}
          project={inboxOf.project}
          openId={inboxOf.messageId}
          closeLabel={inboxOf.messageId !== undefined ? "feed" : backTo}
          onClose={() => {
            const offTheBell = inboxOf.messageId !== undefined;
            setInboxOf(null);
            if (!offTheBell) walkBack();
          }}
        />
      ) : null}

      {/* The footer states what this session is, and stands down while a room is open. */}
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
