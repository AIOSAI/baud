import BranchCard from "./BranchCard";
import type { BranchStatus } from "../types";

interface FleetGridProps {
  branches: BranchStatus[];
}

/** Working agents first, then alphabetical. */
function sortForDisplay(branches: BranchStatus[]): BranchStatus[] {
  return [...branches].sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export default function FleetGrid({ branches }: FleetGridProps) {
  if (branches.length === 0) {
    return <p className="baud-empty">No branches found under src/aipass.</p>;
  }

  return (
    <div className="baud-grid">
      {sortForDisplay(branches).map((branch) => (
        <BranchCard key={branch.name} branch={branch} />
      ))}
    </div>
  );
}
