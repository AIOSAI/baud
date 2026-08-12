import BranchChip, { type LaunchMode } from "./BranchChip";
import type { BranchStatus } from "../types";

interface FleetStripProps {
  branches: BranchStatus[];
  onLaunch: (branch: BranchStatus, mode: LaunchMode) => void;
  onFiles: (branch: BranchStatus) => void;
  onOpenFile: (path: string, name: string, branch: string) => void;
  onOpenDiff: (branch: BranchStatus) => void;
  /** Operator clicked watch: open this branch's scoped monitor pane. */
  onMonitor: (branch: BranchStatus) => void;
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
 * The fleet as one horizontal band above the terminal. It scrolls sideways
 * rather than wrapping, so the terminal below it never loses height as the
 * fleet grows.
 */
export default function FleetStrip({
  branches,
  onLaunch,
  onFiles,
  onOpenFile,
  onOpenDiff,
  onMonitor,
}: FleetStripProps) {
  if (branches.length === 0) {
    return (
      <div className="baud-strip baud-strip-empty">
        <p className="baud-empty">No branches found under src/aipass.</p>
      </div>
    );
  }

  return (
    <div className="baud-strip">
      {sortForDisplay(branches).map((branch) => (
        <BranchChip
          key={branch.name}
          branch={branch}
          onLaunch={onLaunch}
          onFiles={onFiles}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
          onMonitor={onMonitor}
        />
      ))}
    </div>
  );
}
