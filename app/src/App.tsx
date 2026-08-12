import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import Camera from "./components/Camera";
import FleetStrip from "./components/FleetStrip";
import type { LaunchMode } from "./components/BranchChip";
import DiffView from "./components/DiffView";
import FileTree from "./components/FileTree";
import FileView from "./components/FileView";
import MonitorPane from "./components/MonitorPane";
import ProjectSwitch from "./components/ProjectSwitch";
import Terminal, { type TerminalHandle } from "./components/Terminal";
import Zoom from "./components/Zoom";
import { relativeAge } from "./age";
import type { BranchStatus, FleetSnapshot } from "./types";

const POLL_INTERVAL_MS = 5000;

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
  kind: "file" | "diff" | "monitor";
  /** The branch directory a diff tab reads - unused by other kinds. */
  dir?: string;
  /** Jump target from a ctrl+clicked `path:line` mention in the terminal. */
  line?: number;
  /** What a monitor tab watches - null is prax mission control. */
  target?: string | null;
}

/** The terminal's reserved tab id - never closable, never a real path. */
const TERMINAL_TAB = "terminal";

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
] as const;

type MonitorSpec = (typeof MONITOR_TOGGLES)[number];

export default function App() {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const terminalRef = useRef<TerminalHandle>(null);
  // The latest snapshot, reachable from stable callbacks (openFromTerminal).
  const snapshotRef = useRef<FleetSnapshot | null>(null);

  // The reading room: which branch's tree is docked, which files are open,
  // which pane is on top. The terminal is ALWAYS mounted - switching tabs
  // hides it (claude keeps streaming underneath), never unmounts it.
  const [treeBranch, setTreeBranch] = useState<BranchStatus | null>(null);
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>(TERMINAL_TAB);

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
  const launch = useCallback((branch: BranchStatus, mode: LaunchMode) => {
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
      command: `cd ${quote(branch.path)} && command claude --permission-mode bypassPermissions${resume}`,
      typeIfAttached: !branch.interactive,
    });
    // A launch is a statement of intent: bring the terminal forward.
    setActiveTab(TERMINAL_TAB);
  }, []);

  // Deliver file paths INTO the chat box (m8): quoted only when they need
  // it, wrapped in spaces so they join whatever the operator was typing,
  // never submitted - Enter stays the operator's keystroke. Used by the
  // camera button and the drop handler alike.
  const deliverPaths = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const quote = (text: string) =>
      /[\s'"]/.test(text) ? `'${text.replace(/'/g, `'\\''`)}'` : text;
    const typed = terminalRef.current?.typeText(` ${paths.map(quote).join(" ")} `) ?? false;
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
      const next = await invoke<FleetSnapshot>("fleet_snapshot");
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

  useEffect(() => {
    let mounted = true;
    const alive = () => mounted;

    void poll(alive);
    const timer = window.setInterval(() => void poll(alive), POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [poll]);

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
    void poll(() => true);
  }, [poll]);

  const branches = snapshot?.branches ?? [];
  const citizens = branches.filter((branch) => branch.is_citizen).length;
  const dispatched = branches.filter((branch) => branch.dispatched).length;
  const interactive = branches.filter((branch) => branch.interactive).length;
  const unread = branches.reduce((total, branch) => total + branch.new_mail, 0);
  const plans = branches.reduce((total, branch) => total + branch.active_plans, 0);

  // Root resolution failure comes back inside the payload; a broken IPC call
  // comes back as a thrown error. Both are shown, never swallowed.
  const failure = transportError ?? snapshot?.error ?? null;

  const pollStatus = transportError
    ? "poll failing"
    : snapshot
      ? `polled ${relativeAge(snapshot.generated_at).label} · every ${POLL_INTERVAL_MS / 1000}s`
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
          </div>
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
          {/* Notifications bell - a PLACEHOLDER on purpose (Patrick
              2026-08-10): the reminder that BAUD-native notifications are
              coming. It renders, it explains itself, it does nothing yet. */}
          <button
            type="button"
            className="baud-tool-btn baud-tool-btn-placeholder"
            title="notifications - placeholder, the bell gets wired later"
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

      {snapshot === null && !failure ? (
        <div className="baud-strip baud-strip-empty">
          <p className="baud-empty">Waiting for the first snapshot…</p>
        </div>
      ) : (
        <FleetStrip
          branches={branches}
          onLaunch={launch}
          onFiles={toggleTree}
          onOpenFile={openFile}
          onOpenDiff={openDiff}
        />
      )}

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
              liveBranches={branches.filter((b) => b.interactive).map((b) => b.name)}
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
  value: number;
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
