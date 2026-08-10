import type { BranchStatus } from "../types";

const STALE_AFTER_SECONDS = 60 * 60;

export interface RelativeAge {
  label: string;
  stale: boolean;
}

/**
 * Render an ISO-ish timestamp as a short age, e.g. "3m ago".
 * Dashboard files carry naive local timestamps, which `Date.parse` reads as
 * local time - which is exactly what we want here.
 */
export function relativeAge(timestamp: string, now: number = Date.now()): RelativeAge {
  if (!timestamp) return { label: "never", stale: true };

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return { label: "unreadable", stale: true };

  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  const stale = seconds > STALE_AFTER_SECONDS;

  if (seconds < 60) return { label: `${seconds}s ago`, stale };

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { label: `${minutes}m ago`, stale };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `${hours}h ago`, stale };

  return { label: `${Math.floor(hours / 24)}d ago`, stale };
}

interface BranchCardProps {
  branch: BranchStatus;
}

export default function BranchCard({ branch }: BranchCardProps) {
  const age = relativeAge(branch.last_updated);

  const cardClass = [
    "baud-card",
    branch.working ? "baud-card-working" : "baud-card-idle",
    branch.is_citizen ? "" : "baud-card-outsider",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClass}>
      <header className="baud-card-head">
        <span
          className={`baud-lamp ${branch.working ? "baud-lamp-live" : "baud-lamp-dim"}`}
          title={branch.working ? "dispatched - working now" : "sleeping"}
          aria-hidden="true"
        />
        <h2 className="baud-card-name">{branch.name}</h2>
        {branch.action_required ? <span className="baud-flag">!</span> : null}
      </header>

      <div className="baud-figures">
        <Figure label="mail" value={branch.new_mail} alert={branch.new_mail > 0} />
        <Figure label="plans" value={branch.active_plans} />
      </div>

      <p className="baud-summary" title={branch.summary}>
        {branch.summary || (branch.is_citizen ? "no status reported" : "not a citizen")}
      </p>

      <footer className={`baud-card-foot ${age.stale ? "baud-stale" : ""}`}>{age.label}</footer>
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
