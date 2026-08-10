import { relativeAge } from "../age";
import type { BranchStatus } from "../types";

interface BranchChipProps {
  branch: BranchStatus;
}

/**
 * One citizen, compressed to a chip: lamp, name, mail, plans. Everything else
 * the snapshot knows - the summary and how stale it is - lives in the tooltip,
 * because the strip is a glance, not a report.
 */
export default function BranchChip({ branch }: BranchChipProps) {
  const age = relativeAge(branch.last_updated);

  const chipClass = [
    "baud-chip",
    branch.working ? "baud-chip-working" : "baud-chip-idle",
    branch.is_citizen ? "" : "baud-chip-outsider",
  ]
    .filter(Boolean)
    .join(" ");

  const summary = branch.summary || (branch.is_citizen ? "no status reported" : "not a citizen");
  const tooltip = `${branch.name} — ${branch.working ? "working" : "sleeping"}\n${summary}\nupdated ${age.label}`;

  return (
    <article className={chipClass} title={tooltip}>
      <header className="baud-chip-head">
        <span
          className={`baud-lamp ${branch.working ? "baud-lamp-live" : "baud-lamp-dim"}`}
          aria-hidden="true"
        />
        <h2 className="baud-chip-name">{branch.name}</h2>
        {branch.action_required ? <span className="baud-flag">!</span> : null}
      </header>

      <div className="baud-chip-figures">
        <Figure label="mail" value={branch.new_mail} alert={branch.new_mail > 0} />
        <Figure label="plans" value={branch.active_plans} />
      </div>
    </article>
  );
}

function Figure({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <span className={`baud-figure ${alert ? "baud-figure-alert" : ""}`}>
      <span className="baud-figure-value">{value}</span>
      <span className="baud-figure-label">{label}</span>
    </span>
  );
}
