import { APP_CARDS, type AppScreen, appCardTitle, appCardView } from "./appCards";
import BranchChip, { type LaunchMode } from "./BranchChip";
import type { PhoneView } from "./phoneView";
import type { BranchStatus } from "../types";

interface FleetStripProps {
  branches: BranchStatus[];
  onLaunch: (branch: BranchStatus, mode: LaunchMode) => void;
  onFiles: (branch: BranchStatus) => void;
  onOpenFile: (path: string, name: string, branch: string) => void;
  onOpenDiff: (branch: BranchStatus) => void;
  /** Operator clicked watch: open this branch's scoped monitor pane. */
  onMonitor: (branch: BranchStatus) => void;
  /** Operator clicked the terminal glyph: open a plain shell in this branch. */
  onShell: (branch: BranchStatus) => void;
  /** The project the view is seated in - cards from elsewhere are roster cards. */
  seatedProject: string | null;
  /** Operator clicked ?: open a help terminal seated in this branch. */
  onHelp: (branch: BranchStatus) => void;
  /** Operator clicked the gear: open this branch's settings panel. */
  onSettings: (branch: BranchStatus) => void;
  /** Operator clicked the avatar: open this agent's passport. */
  onOpenPassport: (branch: BranchStatus) => void;
  /** Opens or fronts a phone-screen tab: an app, or a card's designed read. */
  onOpenPhone: (view: PhoneView) => void;
}

/** Dispatched first, then interactive, then alphabetical. */
function sortForDisplay(branches: BranchStatus[]): BranchStatus[] {
  const rank = (branch: BranchStatus) =>
    branch.dispatched ? 0 : branch.interactive ? 1 : 2;
  return [...branches].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.name.localeCompare(b.name);
  });
}

/**
 * The fleet as one horizontal band; it scrolls sideways rather than wrapping so the terminal keeps its height.
 */
export default function FleetStrip({
  branches,
  onLaunch,
  onFiles,
  onOpenFile,
  onOpenDiff,
  onMonitor,
  onShell,
  onHelp,
  onSettings,
  onOpenPassport,
  onOpenPhone,
  seatedProject,
}: FleetStripProps) {
  return (
    <div className={`baud-strip ${branches.length === 0 ? "baud-strip-empty" : ""}`}>
      {branches.length === 0 ? <p className="baud-empty">No branches found under src/aipass.</p> : null}
      {sortForDisplay(branches).map((branch) => (
        <BranchChip
          key={branch.name}
          branch={branch}
          onLaunch={onLaunch}
          onFiles={onFiles}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
          onMonitor={onMonitor}
          onShell={onShell}
          onHelp={onHelp}
          onSettings={onSettings}
          onOpenPassport={onOpenPassport}
          onOpenPhone={onOpenPhone}
          foreign={seatedProject !== null && branch.project !== seatedProject}
        />
      ))}
      <AppCards seatedProject={seatedProject} onOpenPhone={onOpenPhone} />
    </div>
  );
}

/** The four apps after the agents: a glyph and a name, no lamp, since an app has no session to light. */
function AppCards({
  seatedProject,
  onOpenPhone,
}: {
  seatedProject: string | null;
  onOpenPhone: (view: PhoneView) => void;
}) {
  return (
    <section className="baud-strip-apps" aria-label="Apps">
      <h2 className="baud-strip-apps-head">Apps</h2>
      {APP_CARDS.map((card) => {
        const view = appCardView(card.screen, seatedProject);
        return (
          <button
            key={card.screen}
            type="button"
            className="baud-appcard"
            disabled={view === null}
            title={appCardTitle(card, seatedProject)}
            onClick={() => {
              if (view) onOpenPhone(view);
            }}
          >
            <AppGlyph screen={card.screen} />
            <span className="baud-appcard-name">{card.name}</span>
          </button>
        );
      })}
    </section>
  );
}

function AppGlyph({ screen }: { screen: AppScreen }) {
  return (
    <svg
      className="baud-appcard-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {screen === "git" ? (
        <>
          <circle cx="6" cy="5" r="2.2" />
          <circle cx="6" cy="19" r="2.2" />
          <circle cx="18" cy="9" r="2.2" />
          <path d="M6 7.2v9.6M18 11.2c0 4-6 3-11 6" />
        </>
      ) : screen === "files" ? (
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
      ) : screen === "backup" ? (
        <>
          <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
          <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
        </>
      ) : (
        <>
          <rect x="7" y="7" width="10" height="10" rx="1.5" />
          <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
        </>
      )}
    </svg>
  );
}
