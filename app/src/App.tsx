import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import FleetStrip from "./components/FleetStrip";
import type { LaunchMode } from "./components/BranchChip";
import DiffView from "./components/DiffView";
import FileTree from "./components/FileTree";
import FileView from "./components/FileView";
import Terminal, { type TerminalHandle } from "./components/Terminal";
import Zoom from "./components/Zoom";
import { relativeAge } from "./age";
import type { BranchStatus, FleetSnapshot } from "./types";

const POLL_INTERVAL_MS = 5000;

/**
 * One workbench tab. A `file` tab views the file at `path`; a `diff` tab
 * shows the branch dir's uncommitted git diff, with `path` carrying a
 * synthetic `diff:` id so the two kinds can never collide on one file.
 */
interface FileTab {
  path: string;
  name: string;
  branch: string;
  kind: "file" | "diff";
  /** The branch directory a diff tab reads - unused by file tabs. */
  dir?: string;
  /** Jump target from a ctrl+clicked `path:line` mention in the terminal. */
  line?: number;
}

/** The terminal's reserved tab id - never closable, never a real path. */
const TERMINAL_TAB = "terminal";

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
  // wins - branch trees nest), or plain "aipass" outside any branch.
  const openFromTerminal = useCallback(
    (path: string, line: number | null) => {
      const name = path.split("/").pop() ?? path;
      const owner = (snapshotRef.current?.branches ?? [])
        .filter((branch) => path.startsWith(`${branch.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0];
      openFile(path, name, owner?.name ?? "aipass", line);
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
        <span className="baud-wordmark">BAUD</span>

        <div className="baud-header-side">
          <div className="baud-totals">
            <Total label="citizens" value={citizens} />
            <Total label="dispatched" value={dispatched} tone={dispatched > 0 ? "alert" : undefined} />
            <Total label="interactive" value={interactive} tone={interactive > 0 ? "live" : undefined} />
            <Total label="unread mail" value={unread} tone={unread > 0 ? "alert" : undefined} />
            <Total label="plans" value={plans} />
          </div>
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
            <Terminal ref={terminalRef} onOpenFile={openFromTerminal} />
          </div>
          {fileTabs.map((tab) => (
            <div
              key={tab.path}
              className={`baud-pane ${activeTab === tab.path ? "" : "baud-pane-hidden"}`}
            >
              {tab.kind === "diff" ? (
                <DiffView dir={tab.dir ?? ""} active={activeTab === tab.path} />
              ) : (
                <FileView path={tab.path} line={tab.line} />
              )}
            </div>
          ))}
        </section>
      </main>

      <footer className="baud-footer">
        <span className="baud-footer-root" title={snapshot?.aipass_root ?? ""}>
          {snapshot?.aipass_root || "resolving AIPass root…"}
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
