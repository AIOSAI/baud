import { useCallback, useEffect, useRef, useState } from "react";
import { agentRoster, baudSettingsRead, fleetSnapshot, gitProjectChanges } from "./host";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { deliveryText } from "./deliver";

import AgentSettings from "./components/AgentSettings";
import Bell from "./components/Bell";
import Camera from "./components/Camera";
import FleetStrip from "./components/FleetStrip";
import InterfaceSettings, { interfacePrefs } from "./components/InterfaceSettings";
import { GIT_POLL_MS, type LaunchMode } from "./components/BranchChip";
import DiffView from "./components/DiffView";
import FileTree from "./components/FileTree";
import FileView from "./components/FileView";
import InquiryPane, { helpCommand } from "./components/InquiryPane";
import MonitorPane from "./components/MonitorPane";
import ProjectSwitch from "./components/ProjectSwitch";
import Terminal, { type TerminalHandle } from "./components/Terminal";
import Zoom from "./components/Zoom";
import { relativeAge } from "./age";
import {
  clearRoomEnded,
  markRoomEnded,
  roomEnded,
  spendStartup,
  startupSpent,
} from "./intent";
import type { BaudSettings, BranchStatus, FleetSnapshot } from "./types";

/**
 * Which door a card click would take for this branch - BranchChip's own
 * judgment, mirrored here so the startup agent (m11 phase 6) opens exactly
 * what a click on its card would: a live session ATTACHES (nothing is typed),
 * a branch with interactive history or a dispatch transcript RESUMES,
 * anything else starts fresh.
 */
function cardMode(branch: BranchStatus): LaunchMode {
  const live = (branch.has_room || branch.outside_room !== null) && branch.interactive;
  return live || branch.has_history || branch.resume_id !== null ? "resume" : "fresh";
}

/**
 * One workbench tab. A `file` tab views the file at `path`; a `diff` tab
 * shows the branch dir's uncommitted git diff; a `monitor` tab holds a
 * tier-0 read-only monitor pane (m9). Non-file kinds carry synthetic
 * `diff:` / `monitor:` ids so the kinds can never collide on one path.
 */
interface FileTab {
  path: string;
  name: string;
  branch: string;
  kind: "file" | "diff" | "monitor" | "inquiry";
  /** The branch directory a diff tab reads or an inquiry shell opens in. */
  dir?: string;
  /** What an inquiry shell types on open - absent is a bare prompt. */
  command?: string | null;
  /** Jump target from a ctrl+clicked `path:line` mention in the terminal. */
  line?: number;
  /** What a monitor tab watches - null is prax mission control. */
  target?: string | null;
}

/**
 * Which passports the strip shows. `current` is the seated project's fleet -
 * the original strip, untouched. `live` and `dispatched` are census-wide
 * filters: the same cards, gathered from every project, so the operator can
 * reach a manager in another tree without moving the seat.
 */
type StripTab = "current" | "live" | "dispatched";

const STRIP_TABS: { id: StripTab; label: string; hint: string }[] = [
  {
    id: "current",
    label: "current project",
    hint: "the project named in the chip above - every branch it has",
  },
  {
    id: "live",
    label: "live agents",
    hint: "every project: agents with a live interactive claude right now",
  },
  {
    id: "dispatched",
    label: "dispatched",
    hint: "every project: agents working a dispatch right now",
  },
];

/** The terminal's reserved tab id - never closable, never a real path. */
const TERMINAL_TAB = "terminal";

/** What a tier-0 monitor pane needs to exist as a tab (m9). */
interface MonitorSpec {
  /** Doubles as the tab path - one pane per id, ever. */
  id: string;
  /** Backend target token: null = all branches, else commons/branch list. */
  target: string | null;
  branch: string;
  name: string;
}

/**
 * The header's tier-0 monitor toggles (m9), one traffic light each. The
 * `id` doubles as the tab path, so "is it live" is one lookup and every
 * close door resets the light through the same closeFile.
 */
const MONITOR_TOGGLES = [
  {
    id: "monitor:prax",
    target: null,
    branch: "prax",
    name: "monitor",
    label: "prax",
    onTitle: "prax mission control is live - click to close the monitor",
    offTitle: "open prax mission control - a read-only live view of every branch",
  },
  {
    id: "monitor:commons",
    target: "commons",
    branch: "commons",
    name: "feed",
    label: "commons",
    onTitle: "the commons feed is live - click to close it",
    offTitle: "open the commons live feed - posts, comments, votes, read-only",
  },
] as const satisfies readonly (MonitorSpec & {
  label: string;
  onTitle: string;
  offTitle: string;
})[];

export default function App() {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const terminalRef = useRef<TerminalHandle>(null);
  // The latest snapshot, reachable from stable callbacks (openFromTerminal).
  const snapshotRef = useRef<FleetSnapshot | null>(null);
  // Whether the operator has already taken a seat - that outranks the startup
  // preference. A ref is enough for this one: a seat can only be taken after
  // the first snapshot has landed, which is the same moment the startup shot
  // is spent, and the SHOT survives remounts (intent.ts). The shot itself
  // deliberately does not live here - see the startup effect below.
  const seatedRef = useRef(false);

  // The reading room: which branch's tree is docked, which files are open,
  // which pane is on top. The terminal is ALWAYS mounted - switching tabs
  // hides it (claude keeps streaming underneath), never unmounts it.
  const [treeBranch, setTreeBranch] = useState<BranchStatus | null>(null);
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>(TERMINAL_TAB);

  // The gear panel (m11): one agent at a time, owned here rather than by the
  // card, so two cards can never have a panel open at once. Not a tab - it is
  // a modal glance over the whole app, and it closes with itself.
  const [settingsAgent, setSettingsAgent] = useState<string | null>(null);
  const openSettings = useCallback(
    (branch: BranchStatus) => setSettingsAgent(branch.name),
    [],
  );
  const closeSettings = useCallback(() => setSettingsAgent(null), []);

  // BAUD's own settings (m11 phase 6): the header gear. `null` means the read
  // has not landed yet - the app runs on defaults until it does, and the
  // startup agent waits for it rather than firing on a guess.
  const [baudSettings, setBaudSettings] = useState<BaudSettings | null>(null);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const prefs = interfacePrefs(baudSettings);

  // Per project - the settings file lives under the seated root, so a switch
  // re-reads it. A failed read settles on `{}`: defaults, and nothing hangs.
  const loadSettings = useCallback(() => {
    baudSettingsRead()
      .then(setBaudSettings)
      .catch(() => setBaudSettings({}));
  }, []);

  useEffect(loadSettings, [loadSettings]);

  const toggleTree = useCallback((branch: BranchStatus) => {
    setTreeBranch((current) => (current?.name === branch.name ? null : branch));
  }, []);

  const openFile = useCallback(
    (path: string, name: string, branch: string, line?: number | null) => {
      setFileTabs((current) => {
        const existing = current.some((tab) => tab.path === path);
        if (!existing) {
          return [...current, { path, name, branch, kind: "file" as const, line: line ?? undefined }];
        }
        // Re-opening with a NEW line moves the open tab there; without one,
        // the tab just comes forward as it is.
        return line == null
          ? current
          : current.map((tab) => (tab.path === path ? { ...tab, line } : tab));
      });
      setActiveTab(path);
    },
    [],
  );

  // A ctrl+clicked path in the terminal arrives resolved and absolute; the
  // tab's branch label is whichever branch's directory contains it (deepest
  // wins - branch trees nest), or the seated project outside any branch.
  const openFromTerminal = useCallback(
    (path: string, line: number | null) => {
      const name = path.split("/").pop() ?? path;
      const owner = (snapshotRef.current?.branches ?? [])
        .filter((branch) => path.startsWith(`${branch.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0];
      const fallback = snapshotRef.current?.project.toLowerCase() || "project";
      openFile(path, name, owner?.name ?? fallback, line);
    },
    [openFile],
  );

  const openDiff = useCallback((branch: BranchStatus) => {
    const id = `diff:${branch.path}`;
    setFileTabs((current) =>
      current.some((tab) => tab.path === id)
        ? current
        : [
            ...current,
            {
              path: id,
              name: "changes",
              branch: branch.name,
              kind: "diff" as const,
              dir: branch.path,
            },
          ],
    );
    setActiveTab(id);
  }, []);

  const closeFile = useCallback((path: string) => {
    setFileTabs((current) => current.filter((tab) => tab.path !== path));
    setActiveTab((current) => (current === path ? TERMINAL_TAB : current));
  }, []);

  // A header monitor toggle (m9): green while its pane lives, off when it
  // does not - and "lives" is literally "the tab exists", so a pane killed
  // by its corner button or a monitor that dies on its own resets the
  // toggle through the same closeFile door. No second state to drift.
  // Opening half only - the closing half is closeFile, same as every tab.
  const openMonitor = useCallback(
    (spec: MonitorSpec) => {
      setFileTabs((current) => {
        if (current.some((tab) => tab.path === spec.id)) return current;
        return [
          ...current,
          {
            path: spec.id,
            name: spec.name,
            branch: spec.branch,
            kind: "monitor" as const,
            target: spec.target,
          },
        ];
      });
      setActiveTab((current) => (current === spec.id ? current : spec.id));
    },
    [],
  );

  // The card's help button (m9 phase 4): a tier-1 inquiry terminal - real
  // shell, real keyboard, seated in the branch with the help already run.
  // Same door semantics as watch: re-click brings the open one forward.
  const helpBranch = useCallback((branch: BranchStatus) => {
    const id = `help:${branch.name}`;
    setFileTabs((current) => {
      if (current.some((tab) => tab.path === id)) return current;
      return [
        ...current,
        {
          path: id,
          name: "help",
          branch: branch.name,
          kind: "inquiry" as const,
          dir: branch.path,
          command: helpCommand(branch.name),
        },
      ];
    });
    setActiveTab(id);
  }, []);

  // The terminal buttons: a plain working shell in a tab, nothing typed.
  // Keyed by directory rather than name, so the project shell and a branch
  // shell can never collide on one tab and a re-click brings the open one
  // forward - doors, not toggles, same as watch and help.
  const openShell = useCallback((dir: string, label: string) => {
    const id = `shell:${dir}`;
    setFileTabs((current) => {
      if (current.some((tab) => tab.path === id)) return current;
      return [
        ...current,
        { path: id, name: "shell", branch: label, kind: "inquiry" as const, dir },
      ];
    });
    setActiveTab(id);
  }, []);

  const shellBranch = useCallback(
    (branch: BranchStatus) => openShell(branch.path, branch.name),
    [openShell],
  );

  // The card's watch button (m9 phase 3): this branch's activity alone.
  // Re-clicking an open one brings its tab forward - cards are doors, not
  // toggles; closing stays with the tab's own ✕ and the pane's corner.
  // Own `watch:` namespace: the prax CARD's scoped pane and the header's
  // mission-control pane are different panes and must never share a tab.
  // (Quirk, accepted: prax maps the `commons` target to the social feed,
  // so the commons card's watch shows the feed, not technical logs.)
  const monitorBranch = useCallback(
    (branch: BranchStatus) => {
      openMonitor({
        id: `watch:${branch.name}`,
        target: branch.name,
        branch: branch.name,
        name: "watch",
      });
    },
    [openMonitor],
  );

  // The launch buttons since m6: a window into the branch's ROOM. Switching
  // cards detaches the old room (it keeps running) and attaches the next.
  // The claude command line is staged for rooms that can take it - freshly
  // created, or sitting at a prompt with no live claude (`typeIfAttached`);
  // an attach onto a live claude types nothing, because the "input" would
  // land in claude's message box. Resume takes whichever door exists: `-c`
  // for interactive history, `--resume <id>` when only headless dispatch
  // transcripts do (`-c` refuses those). Single-quoted so odd paths survive
  // the shell. `command claude` skips the bashrc boot shim (@hooks
  // session_boot): its continue/new menu is redundant here - the button
  // press already made that choice.
  //
  // This line is the TERMINAL SLOT (Patrick's ruling 2026-08-14): BAUD is
  // terminal-agnostic, and everything Claude-specific about a launch lives
  // here and nowhere deeper. AIPass does the work, BAUD is the face, and the
  // terminal is a component wired into it - claude today, codex or a native
  // AIPass terminal tomorrow, selected the way a model is selected. Nothing
  // below this callback may assume which terminal it is.
  //
  // Deliberately NOT here: `--remote-control`. Remote Control is a
  // Claude-native convenience like attach - real, usable when present, and
  // never load-bearing. Wiring it into the door would make the fleet depend on
  // one terminal's feature set, which is the dependency the slot exists to
  // prevent. (Built and reverted the same sitting on Patrick's ruling; the
  // verified findings live in FPLAN-0412 Phase 0.)
  const launch = useCallback((branch: BranchStatus, mode: LaunchMode) => {
    // A seat exists from here on - the startup agent stands down (m11 p6).
    seatedRef.current = true;
    // The operator opening this card is the one door that revives an ended
    // room (Patrick ruling 2026-08-12) - clicking it IS the resume.
    clearRoomEnded(snapshotRef.current?.project ?? "", branch.name);
    const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
    const resume =
      mode !== "resume"
        ? ""
        : branch.has_history
          ? " -c"
          : branch.resume_id
            ? ` --resume ${quote(branch.resume_id)}`
            : "";
    terminalRef.current?.launch({
      room: branch.name,
      cwd: branch.path,
      // The card's own project, not the seat's: a roster card is often from
      // somewhere else, and the room name carries its project.
      project: branch.project,
      command: `cd ${quote(branch.path)} && command claude --permission-mode bypassPermissions${resume}`,
      typeIfAttached: !branch.interactive,
    });
    // A launch is a statement of intent: bring the terminal forward.
    setActiveTab(TERMINAL_TAB);
  }, []);

  // The startup agent (m11 phase 6): ONCE per app run, as soon as the first
  // snapshot and the settings have both landed, BAUD opens the seat the
  // operator named - through `launch`, the very door a card click uses, with
  // the card's own attach/resume/fresh judgment. The attempt is marked spent
  // whatever the outcome, so a later snapshot can never re-fire it, and an
  // operator who already picked a card outranks the preference. A named agent
  // with no card here is a quiet console line: a missing branch is not a fault
  // worth a FAULT banner over.
  //
  // The shot is spent in sessionStorage, not a ref (m12): a ref is re-armed by
  // every hot reload, and a re-armed startup agent RESURRECTS the room the
  // operator just ended - the exact bug Patrick caught at 18:27. Two guards,
  // because they answer different questions: the shot says "BAUD already
  // opened this run", the ended mark says "this agent stays dead until I open
  // its card myself".
  useEffect(() => {
    if (!snapshot || !baudSettings || startupSpent()) return;
    spendStartup();
    if (!prefs.startupAgent || seatedRef.current) return;
    const branch = snapshot.branches.find((item) => item.name === prefs.startupAgent);
    if (!branch) {
      console.warn(`startup agent '${prefs.startupAgent}' has no card here - opening nothing`);
      return;
    }
    if (roomEnded(snapshot.project, branch.name)) {
      console.info(
        `startup agent '${branch.name}' stays closed - you ended its room; open its card to bring it back`,
      );
      return;
    }
    launch(branch, cardMode(branch));
  }, [snapshot, baudSettings, prefs.startupAgent, launch]);

  // Deliver file paths INTO the chat box (m8). The rule itself - quote only
  // when needed, wrap in spaces, never submit - moved to `deliver.ts` when the
  // phone's photo lane needed the same delivery: a quoting rule with shell
  // semantics must exist once or it drifts. Used by the camera button and the
  // drop handler alike.
  const deliverPaths = useCallback((paths: string[]) => {
    const text = deliveryText(paths);
    if (!text) return;
    const typed = terminalRef.current?.typeText(text) ?? false;
    // The delivery's whole point is the chat box - bring it forward.
    if (typed) setActiveTab(TERMINAL_TAB);
  }, []);

  // Drag-drop (m8): dropped files become their paths in the chat box - the
  // same thing dropping onto a real terminal does. The webview intercepts
  // the drop (so the navigation fence never sees a file:// load) and hands
  // us real filesystem paths.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        deliverPaths(event.payload.paths ?? []);
      })
      .then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [deliverPaths]);

  const poll = useCallback(async (alive: () => boolean) => {
    try {
      const next = await fleetSnapshot();
      if (!alive()) return;
      snapshotRef.current = next;
      setSnapshot(next);
      setTransportError(null);
    } catch (err) {
      if (!alive()) return;
      setTransportError(
        err instanceof Error ? err.message : `fleet_snapshot failed: ${String(err)}`,
      );
    }
  }, []);

  // The terminal ended a room (m12). tmux has confirmed the kill, so record
  // the intent where a hot reload cannot forget it: nothing in BAUD reopens
  // this agent until the operator clicks its card. Then re-poll, because the
  // fleet just changed and a dead room should not linger on a card for 5s.
  const roomWasEnded = useCallback(
    (branch: string) => {
      markRoomEnded(snapshotRef.current?.project ?? "", branch);
      void poll(() => true);
    },
    [poll],
  );

  useEffect(() => {
    let mounted = true;
    const alive = () => mounted;

    void poll(alive);
    // The snapshot poll is frontend-driven (one interval, one command), so
    // the interface setting reaches it directly - a new cadence rebuilds the
    // timer and takes effect on the spot.
    const timer = window.setInterval(() => void poll(alive), prefs.pollMs);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [poll, prefs.pollMs]);

  // A project switch moves the fence, so the reading room empties: old tabs
  // and the docked tree point where the backend now rightly refuses to read.
  // The terminal stays untouched - an attached room keeps running (rooms
  // doctrine: only "end room" kills), and the scratch shell is the
  // operator's own business. Then poll immediately so the new fleet appears
  // without waiting out the 5s tick.
  const reseat = useCallback(() => {
    setFileTabs([]);
    setTreeBranch(null);
    setActiveTab(TERMINAL_TAB);
    // A panel pointed at a branch of the old project has nothing to write to.
    setSettingsAgent(null);
    setInterfaceOpen(false);
    // Interface settings live under the seated root - the new project has
    // its own file, and possibly its own answers.
    loadSettings();
    void poll(() => true);
  }, [poll, loadSettings]);

  const branches = snapshot?.branches ?? [];
  const citizens = branches.filter((branch) => branch.is_citizen).length;
  const dispatched = branches.filter((branch) => branch.dispatched).length;
  const interactive = branches.filter((branch) => branch.interactive).length;
  const unread = branches.reduce((total, branch) => total + branch.new_mail, 0);
  const plans = branches.reduce((total, branch) => total + branch.active_plans, 0);

  // The roster tabs. `current` is the seated project's own strip, unchanged;
  // the other two sweep every project so two managers in two projects sit one
  // click apart without the project chip moving. Polled only while a roster
  // tab is open - a census-wide sweep that nobody is looking at is waste.
  const [roster, setRoster] = useState<BranchStatus[]>([]);
  const [stripTab, setStripTab] = useState<StripTab>("current");
  useEffect(() => {
    if (stripTab === "current") return;
    let mounted = true;
    const refresh = () => {
      agentRoster()
        .then((next) => {
          if (mounted) setRoster(next);
        })
        .catch(() => {
          if (mounted) setRoster([]);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, prefs.pollMs);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [stripTab, prefs.pollMs]);

  const stripBranches =
    stripTab === "current"
      ? branches
      : roster.filter((branch) => (stripTab === "live" ? branch.interactive : branch.dispatched));

  // Whole-project uncommitted count. Not a sum of the cards: those ask
  // `diff HEAD` about their own subtree and cannot see files git has never
  // seen, so a new module counts here and nowhere else. Its own slow tick at
  // the cards' cadence - one subprocess a tick is real work - and it re-reads
  // when the operator seats the view in another project.
  const [projectChanges, setProjectChanges] = useState<number | null>(null);
  const seatedRoot = snapshot?.root ?? null;
  useEffect(() => {
    if (seatedRoot === null) return;
    let mounted = true;
    const refresh = () => {
      gitProjectChanges()
        .then((next) => {
          if (mounted) setProjectChanges(next.count);
        })
        .catch(() => {
          if (mounted) setProjectChanges(null);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, GIT_POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [seatedRoot]);

  // Root resolution failure comes back inside the payload; a broken IPC call
  // comes back as a thrown error. Both are shown, never swallowed.
  const failure = transportError ?? snapshot?.error ?? null;

  const pollStatus = transportError
    ? "poll failing"
    : snapshot
      ? `polled ${relativeAge(snapshot.generated_at).label} · every ${prefs.pollMs / 1000}s`
      : "waiting for the first snapshot…";

  return (
    <div className="baud-app">
      <header className="baud-header">
        <div className="baud-header-brand">
          <span className="baud-wordmark">BAUD</span>
          <ProjectSwitch project={snapshot?.project ?? null} onSwitched={reseat} />
        </div>

        <div className="baud-header-side">
          <div className="baud-totals">
            <Total label="citizens" value={citizens} />
            <Total label="dispatched" value={dispatched} tone={dispatched > 0 ? "alert" : undefined} />
            <Total label="interactive" value={interactive} tone={interactive > 0 ? "live" : undefined} />
            <Total label="unread mail" value={unread} tone={unread > 0 ? "alert" : undefined} />
            <Total label="plans" value={plans} />
            <Total label="changes" value={projectChanges ?? "—"} />
          </div>
          {/* A working shell at the seated project's root - the global one.
              Follows the project chip: reseat, and the next click opens the
              new root. Disabled until a snapshot names that root, because a
              shell that guesses where it is would be worse than none. */}
          <button
            type="button"
            className="baud-tool-btn"
            title={
              seatedRoot
                ? `open a terminal at ${seatedRoot}`
                : "waiting for the project root…"
            }
            disabled={seatedRoot === null}
            onClick={() => {
              if (seatedRoot) openShell(seatedRoot, snapshot?.project ?? "project");
            }}
          >
            ❯_
          </button>
          {MONITOR_TOGGLES.map((spec) => {
            const live = fileTabs.some((tab) => tab.path === spec.id);
            return (
              <button
                key={spec.id}
                type="button"
                className={`baud-monitor-toggle ${live ? "baud-monitor-toggle-live" : ""}`}
                title={live ? spec.onTitle : spec.offTitle}
                onClick={() => (live ? closeFile(spec.id) : openMonitor(spec))}
              >
                <span className="baud-monitor-dot" aria-hidden="true" />
                {spec.label}
              </button>
            );
          })}
          <Camera onCaptured={(path) => deliverPaths([path])} />
          {/* The bell, wired (m10): desktop toasts are retired - ai_mail's
              notification feed lands here instead. Its cadence, retention and
              chime come from BAUD's own settings (m11 phase 6). */}
          <Bell
            project={snapshot?.project ?? null}
            pollMs={prefs.pollMs}
            maxEvents={prefs.bellMax}
            sound={prefs.bellSound}
          />
          {/* BAUD's gear, sibling to the cards' (m11 phase 6): this one is
              about the interface itself, not any one agent. */}
          <button
            type="button"
            className="baud-tool-btn"
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
          <Zoom />
        </div>
      </header>

      {failure ? (
        <div className="baud-failure" role="alert">
          <span className="baud-failure-tag">FAULT</span>
          <span className="baud-failure-text">{failure}</span>
        </div>
      ) : null}

      {/* Names the strip for what a card actually is: one agent's passport,
          and which passports are on show. Always rendered, so the region is
          labelled while the first snapshot is still in flight. */}
      <div className="baud-section-head">
        <span className="baud-section-label">Agent Passports</span>
        <span className="baud-section-tabs" role="tablist" aria-label="which passports">
          {STRIP_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={stripTab === tab.id}
              className={`baud-section-tab${stripTab === tab.id ? " baud-section-tab-on" : ""}`}
              title={tab.hint}
              onClick={() => setStripTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </span>
      </div>

      {snapshot === null && !failure ? (
        <div className="baud-strip baud-strip-empty">
          <p className="baud-empty">Waiting for the first snapshot…</p>
        </div>
      ) : stripTab !== "current" && stripBranches.length === 0 ? (
        <div className="baud-strip baud-strip-empty">
          <p className="baud-empty">
            {stripTab === "live"
              ? "No agent has a live session right now, in any project."
              : "No agent is working a dispatch right now, in any project."}
          </p>
        </div>
      ) : (
        <FleetStrip
          branches={stripBranches}
          onLaunch={launch}
          onFiles={toggleTree}
          onOpenFile={openFile}
          onOpenDiff={openDiff}
          onMonitor={monitorBranch}
          onShell={shellBranch}
          seatedProject={snapshot?.project ?? null}
          onHelp={helpBranch}
          onSettings={openSettings}
        />
      )}

      {settingsAgent ? (
        <AgentSettings agent={settingsAgent} onClose={closeSettings} />
      ) : null}

      {interfaceOpen ? (
        <InterfaceSettings
          agents={branches.map((branch) => branch.name)}
          settings={baudSettings ?? {}}
          onSaved={setBaudSettings}
          onClose={() => setInterfaceOpen(false)}
        />
      ) : null}

      <main className="baud-stage">
        {treeBranch ? (
          <FileTree
            branch={treeBranch}
            onOpen={openFile}
            onClose={() => setTreeBranch(null)}
          />
        ) : null}

        <section className="baud-workbench">
          {fileTabs.length > 0 ? (
            <nav className="baud-tabbar">
              <button
                type="button"
                className={`baud-tab ${activeTab === TERMINAL_TAB ? "baud-tab-active" : ""}`}
                onClick={() => setActiveTab(TERMINAL_TAB)}
              >
                terminal
              </button>
              {fileTabs.map((tab) => (
                <span
                  key={tab.path}
                  className={`baud-tab ${activeTab === tab.path ? "baud-tab-active" : ""}`}
                >
                  <button
                    type="button"
                    className="baud-tab-name"
                    title={tab.path}
                    onClick={() => setActiveTab(tab.path)}
                  >
                    {tab.branch}/{tab.name}
                  </button>
                  <button
                    type="button"
                    className="baud-tab-close"
                    title="close"
                    onClick={() => closeFile(tab.path)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </nav>
          ) : null}

          <div
            className={`baud-pane ${activeTab === TERMINAL_TAB ? "" : "baud-pane-hidden"}`}
          >
            <Terminal
              ref={terminalRef}
              onOpenFile={openFromTerminal}
              onRoomEnded={roomWasEnded}
              liveSessions={snapshot?.live_agent_sessions ?? []}
            />
          </div>
          {fileTabs.map((tab) => (
            <div
              key={tab.path}
              className={`baud-pane ${activeTab === tab.path ? "" : "baud-pane-hidden"}`}
            >
              {tab.kind === "diff" ? (
                <DiffView dir={tab.dir ?? ""} active={activeTab === tab.path} />
              ) : tab.kind === "monitor" ? (
                <MonitorPane
                  target={tab.target ?? null}
                  label={`${tab.branch} ${tab.name}`}
                  onExited={() => closeFile(tab.path)}
                />
              ) : tab.kind === "inquiry" ? (
                <InquiryPane
                  branch={tab.branch}
                  cwd={tab.dir ?? ""}
                  command={tab.command ?? null}
                  onExited={() => closeFile(tab.path)}
                />
              ) : (
                <FileView path={tab.path} line={tab.line} />
              )}
            </div>
          ))}
        </section>
      </main>

      <footer className="baud-footer">
        <span className="baud-footer-root" title={snapshot?.root ?? ""}>
          {snapshot?.root || "resolving project root…"}
        </span>
        <span className={`baud-footer-poll ${transportError ? "baud-footer-poll-alert" : ""}`}>
          {pollStatus}
        </span>
      </footer>
    </div>
  );
}

function Total({
  label,
  value,
  tone,
}: {
  label: string;
  /** A string carries the honest unknown ("—") when a read failed; a zero
   *  there would be a claim the tree is clean when we simply do not know. */
  value: number | string;
  tone?: "live" | "alert";
}) {
  const toneClass = tone ? ` baud-total-${tone}` : "";
  return (
    <div className={`baud-total${toneClass}`}>
      <span className="baud-total-value">{value}</span>
      <span className="baud-total-label">{label}</span>
    </div>
  );
}
