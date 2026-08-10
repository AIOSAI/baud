import BranchChip from "./BranchChip";
import type { BranchStatus } from "../types";

interface FleetStripProps {
  branches: BranchStatus[];
}

/** Working agents first, then alphabetical. */
function sortForDisplay(branches: BranchStatus[]): BranchStatus[] {
  return [...branches].sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The fleet as one horizontal band above the terminal. It scrolls sideways
 * rather than wrapping, so the terminal below it never loses height as the
 * fleet grows.
 */
export default function FleetStrip({ branches }: FleetStripProps) {
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
        <BranchChip key={branch.name} branch={branch} />
      ))}
    </div>
  );
}
