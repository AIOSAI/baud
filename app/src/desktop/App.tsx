import { useCallback, useEffect, useRef, useState } from "react";
import { agentRoster, baudSettingsRead, fleetSnapshot, gitProjectChanges, projectSwitch } from "../host";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { deliveryText } from "../deliver";

import AgentSettings from "./AgentSettings";
import Bell from "./Bell";
import Camera from "./Camera";
import FleetStrip from "./FleetStrip";
import { interfacePrefs } from "./InterfaceSettings";
import { GIT_POLL_MS, type LaunchMode } from "./BranchChip";
import DiffView from "./DiffView";
import FileTree from "./FileTree";
import FileView from "./FileView";
import InquiryPane, { helpCommand } from "./InquiryPane";
import MonitorPane from "./MonitorPane";
import PassportView from "./PassportView";
import PhoneTab from "./PhoneTab";
import { phoneTabKey, phoneTabLabel, type PhoneView } from "./phoneView";
import ProjectSwitch from "./ProjectSwitch";
import SettingsDialog, { PAIR_COMMAND } from "./SettingsDialog";
import NewProjectSheet from "../phone/NewProjectSheet";
import { bornCard, bornSeat } from "../phone/lib/newProject";
import { agentCommand } from "../phone/lib/rooms";
import Terminal, { type TerminalHandle } from "./Terminal";
import Zoom from "./Zoom";
import { relativeAge } from "../age";
import {
  clearRoomEnded,
  markRoomEnded,
  roomEnded,
  spendStartup,
  startupSpent,
} from "../intent";
import type { BaudSettings, BranchStatus, FleetSnapshot, NewProjectResult } from "../types";

/** BranchChip's door judgment, mirrored so the startup agent opens exactly what a card click would. */
function cardMode(branch: BranchStatus): LaunchMode {
  const live = (branch.has_room || branch.outside_room !== null) && branch.interactive;
  return live || branch.has_history || branch.resume_id !== null ? "resume" : "fresh";
}

/** One workbench tab. Non-file kinds carry synthetic `diff:` / `monitor:` ids so kinds never collide on one path. */
interface FileTab {
  path: string;
  name: string;
  branch: string;
  kind: "file" | "diff" | "monitor" | "inquiry" | "phone";
  /** The branch directory a diff tab reads or an inquiry shell opens in. */
  dir?: string;
  /** What an inquiry shell types on open - absent is a bare prompt. */
  command?: string | null;
  /** Jump target from a ctrl+clicked `path:line` mention in the terminal. */
  line?: number;
  /** What a monitor tab watches - null is prax mission control. */
  target?: string | null;
  /** The phone screen a `phone` tab hosts. */
  view?: PhoneView;
}

/** Which passports the strip shows: the seated fleet, or census-wide `live` / `dispatched` filters. */
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

/** What a monitor pane needs to exist as a tab. */
interface MonitorSpec {
  /** Doubles as the tab path - one pane per id, ever. */
  id: string;
  /** Backend target token: null = all branches, else commons/branch list. */
  target: string | null;
  branch: string;
  name: string;
}

/** The manager's monitor toggles. `id` doubles as the tab path, so "is it live" is one lookup. */
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
  const snapshotRef = useRef<FleetSnapshot | null>(null);
  // A taken seat outranks the startup preference. A ref suffices; the startup shot itself lives in intent.ts.
  const seatedRef = useRef(false);

  // The terminal is ALWAYS mounted: switching tabs hides it, and claude keeps streaming underneath.
  const [treeBranch, setTreeBranch] = useState<BranchStatus | null>(null);
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>(TERMINAL_TAB);

  // Owned here, not by the card, so two cards can never have a panel open at once.
  const [settingsAgent, setSettingsAgent] = useState<string | null>(null);
  const openSettings = useCallback(
    (branch: BranchStatus) => setSettingsAgent(branch.name),
    [],
  );
  const closeSettings = useCallback(() => setSettingsAgent(null), []);

  /** The opened passport holds the IDENTITY, not the row: the row is re-read live each render (`passportBranch`).
   *  `held` is only the fallback for a branch that leaves the list while open. */
  const [passportOf, setPassportOf] = useState<{
    name: string;
    project: string;
    held: BranchStatus;
  } | null>(null);
  const openPassport = useCallback(
    (branch: BranchStatus) =>
      setPassportOf({ name: branch.name, project: branch.project, held: branch }),
    [],
  );

  // null until the read lands: the startup agent waits for it rather than firing on a guess.
  const [baudSettings, setBaudSettings] = useState<BaudSettings | null>(null);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const prefs = interfacePrefs(baudSettings);

  // A failed read settles on `{}`, so nothing waits forever on it.
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
        return line == null
          ? current
          : current.map((tab) => (tab.path === path ? { ...tab, line } : tab));
      });
      setActiveTab(path);
    },
    [],
  );

  // Deepest containing branch wins: branch trees nest.
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

  // Re-opening an open key fronts it with the newer view, so a mail row can retarget an open inbox.
  const openPhone = useCallback((view: PhoneView) => {
    const id = phoneTabKey(view);
    const { branch, name } = phoneTabLabel(view);
    setFileTabs((current) =>
      current.some((tab) => tab.path === id)
        ? current.map((tab) => (tab.path === id ? { ...tab, view } : tab))
        : [...current, { path: id, name, branch, kind: "phone" as const, view }],
    );
    setActiveTab(id);
  }, []);

  const closeFile = useCallback((path: string) => {
    setFileTabs((current) => current.filter((tab) => tab.path !== path));
    setActiveTab((current) => (current === path ? TERMINAL_TAB : current));
  }, []);

  // A toggle's "live" is "the tab exists", so every close resets it through closeFile; no second state.
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

  // Keyed by directory, so the project shell and a branch shell never collide on one tab.
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

  // The help-terminal pattern: keyboard on, the command draws its own QR, `exit` closes the tab.
  const openPairing = useCallback((dir: string) => {
    const id = "pair:phone";
    setFileTabs((current) => {
      if (current.some((tab) => tab.path === id)) return current;
      return [
        ...current,
        { path: id, name: "pair", branch: "phone", kind: "inquiry" as const, dir, command: PAIR_COMMAND },
      ];
    });
    setActiveTab(id);
  }, []);

  const shellBranch = useCallback(
    (branch: BranchStatus) => openShell(branch.path, branch.name),
    [openShell],
  );

  // Own `watch:` namespace: the prax card's scoped pane and mission control must never share a tab.
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

  // THE TERMINAL SLOT: everything Claude-specific about a launch lives here; nothing below may assume the terminal.
  // `--resume <id>` outranks `-c`, which can never enter a dispatched session. A fresh launch is unknown to the
  // session pointer, and pointer writes stay with dispatch. `command claude` skips the bashrc boot shim's menu.
  // `--remote-control` stays out: the fleet must not depend on one terminal's feature set.
  const launch = useCallback((branch: BranchStatus, mode: LaunchMode) => {
    // Resume onto a dispatched session is takeover: a second claude steals its background tasks and the job dies.
    // The card guards this too, but the startup agent calls launch() directly. Interactive means attach, so exempt.
    if (mode === "resume" && branch.dispatched && !branch.interactive) {
      monitorBranch(branch);
      return;
    }
    seatedRef.current = true;
    // Opening the card is the one door that revives an ended room.
    clearRoomEnded(snapshotRef.current?.project ?? "", branch.name);
    const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
    terminalRef.current?.launch({
      room: branch.name,
      cwd: branch.path,
      // The card's own project, not the seat's: a roster card is often from elsewhere.
      project: branch.project,
      command: `cd ${quote(branch.path)} && ${agentCommand(branch, mode === "resume")}`,
      typeIfAttached: !branch.interactive,
    });
    setActiveTab(TERMINAL_TAB);
  }, [monitorBranch]);

  // The startup agent fires ONCE per run, spent whatever the outcome. The shot lives in sessionStorage, not a ref:
  // a hot reload re-arms a ref and would resurrect a room the operator just ended.
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

  // The quoting rule lives once in deliver.ts, shared with the phone's photo lane.
  const deliverPaths = useCallback((paths: string[]) => {
    const text = deliveryText(paths);
    if (!text) return;
    const typed = terminalRef.current?.typeText(text) ?? false;
    if (typed) setActiveTab(TERMINAL_TAB);
  }, []);

  // The webview intercepts the drop, so the navigation fence never sees a file:// load.
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

  // Recorded where a hot reload cannot forget it; nothing reopens this agent until its card is clicked.
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
    const timer = window.setInterval(() => void poll(alive), prefs.pollMs);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [poll, prefs.pollMs]);

  // A project switch moves the fence, so old tabs would be refused. The terminal stays: only "end room" kills.
  const reseat = useCallback(() => {
    setFileTabs([]);
    setTreeBranch(null);
    setActiveTab(TERMINAL_TAB);
    setSettingsAgent(null);
    setInterfaceOpen(false);
    // Interface settings live under the seated root.
    loadSettings();
    void poll(() => true);
  }, [poll, loadSettings]);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // The census name, never the typed one; then the newborn manager's door, which is `fresh` with no history.
  const onProjectBorn = useCallback(
    async (result: NewProjectResult) => {
      setNewProjectOpen(false);
      try {
        await projectSwitch(bornSeat(result));
      } catch (err) {
        setTransportError(
          `created ${result.project}, but could not seat it: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      reseat();
      const card = bornCard(result);
      launch(card, cardMode(card));
    },
    [reseat, launch],
  );

  const branches = snapshot?.branches ?? [];
  const citizens = branches.filter((branch) => branch.is_citizen).length;
  const dispatched = branches.filter((branch) => branch.dispatched).length;
  const interactive = branches.filter((branch) => branch.interactive).length;
  const unread = branches.reduce((total, branch) => total + branch.new_mail, 0);
  const plans = branches.reduce((total, branch) => total + branch.active_plans, 0);

  // The census-wide sweep polls only while a roster tab is open.
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

  /** The passport's row, re-read live: seated snapshot first (fresher), then roster. Identity is name AND project,
   *  or one project's numbers would show under another's passport. */
  const passportBranch = passportOf
    ? (branches.find(
        (branch) => branch.name === passportOf.name && branch.project === passportOf.project,
      ) ??
      roster.find(
        (branch) => branch.name === passportOf.name && branch.project === passportOf.project,
      ) ??
      passportOf.held)
    : null;

  // Not a sum of the cards: their `diff HEAD` cannot see untracked files, so a new module counts only here.
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
          <ProjectSwitch
            project={snapshot?.project ?? null}
            onSwitched={reseat}
            onNewProject={() => setNewProjectOpen(true)}
          />
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
          {/* Disabled until a snapshot names the root: a shell that guesses where it is is worse than none. */}
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
          <Camera onCaptured={(path) => deliverPaths([path])} />
          <Bell
            project={snapshot?.project ?? null}
            pollMs={prefs.pollMs}
            maxEvents={prefs.bellMax}
            sound={prefs.bellSound}
            onOpenMail={openPhone}
          />
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
          onOpenPassport={openPassport}
          onOpenPhone={openPhone}
        />
      )}

      {settingsAgent ? (
        <AgentSettings agent={settingsAgent} onClose={closeSettings} />
      ) : null}

      {/* Monitor toggles only for a manager; their live state derives from the open tabs. */}
      {passportBranch ? (
        <PassportView
          branch={passportBranch}
          onClose={() => setPassportOf(null)}
          monitors={
            passportBranch.manager
              ? MONITOR_TOGGLES.map((spec) => {
                  const live = fileTabs.some((tab) => tab.path === spec.id);
                  return {
                    id: spec.id,
                    label: spec.label,
                    live,
                    title: live ? spec.onTitle : spec.offTitle,
                    onToggle: () => (live ? closeFile(spec.id) : openMonitor(spec)),
                  };
                })
              : []
          }
        />
      ) : null}

      {interfaceOpen ? (
        <SettingsDialog
          agents={branches.map((branch) => branch.name)}
          settings={baudSettings ?? {}}
          onSaved={setBaudSettings}
          onPairPhone={
            seatedRoot
              ? () => {
                  setInterfaceOpen(false);
                  openPairing(seatedRoot);
                }
              : null
          }
          onClose={() => setInterfaceOpen(false)}
        />
      ) : null}

      {newProjectOpen ? (
        <NewProjectSheet onClose={() => setNewProjectOpen(false)} onCreated={(result) => void onProjectBorn(result)} />
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
              {tab.kind === "phone" ? (
                // Only the front tab mounts: GitApp's document-level Escape must not close a tab behind a dialog.
                activeTab === tab.path && tab.view ? (
                  <PhoneTab view={tab.view} onOpen={openPhone} onClose={() => closeFile(tab.path)} />
                ) : null
              ) : tab.kind === "diff" ? (
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
  /** A string carries the honest unknown ("—"): a zero would claim a clean tree. */
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
