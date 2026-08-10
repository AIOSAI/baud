import { relativeAge } from "../age";
import type { BranchStatus } from "../types";

export type LaunchMode = "resume" | "fresh";

interface BranchChipProps {
  branch: BranchStatus;
  /** Operator clicked launch: open a claude session in this branch. */
  onLaunch: (branch: BranchStatus, mode: LaunchMode) => void;
  /** Operator clicked files: open this branch's directory tree. */
  onFiles: (branch: BranchStatus) => void;
  /** Operator clicked a figure or the summary: open the file behind it. */
  onOpenFile: (path: string, name: string, branch: string) => void;
}

/**
 * One citizen, one card: lamp, name, state badge, every quick_status figure,
 * the summary line, and how fresh the dashboard is. The card IS the report -
 * nothing hides in a tooltip anymore.
 *
 * The lamp tells dispatched from interactive apart: a dispatched agent pulses
 * (the machine is churning), an interactive session burns steady (someone is
 * at the wheel), and a branch with neither sits dim.
 */
export default function BranchChip({ branch, onLaunch, onFiles, onOpenFile }: BranchChipProps) {
  const age = relativeAge(branch.last_updated);

  // Every number on the card is a door: clicking it opens the file the
  // number came from, in the reading room.
  const peek = (relative: string, name: string) => () =>
    onOpenFile(`${branch.path}/${relative}`, name, branch.name);
  const peekInbox = peek(".ai_mail.local/inbox.json", "inbox.json");
  const peekTodos = peek(".trinity/local.json", "local.json");
  const peekDashboard = peek("DASHBOARD.local.json", "DASHBOARD.local.json");

  const chipClass = [
    "baud-chip",
    branch.dispatched ? "baud-chip-dispatched" : "",
    branch.interactive ? "baud-chip-interactive" : "",
    branch.is_citizen ? "" : "baud-chip-outsider",
  ]
    .filter(Boolean)
    .join(" ");

  const lampClass = branch.dispatched
    ? "baud-lamp-dispatched"
    : branch.interactive
      ? "baud-lamp-interactive"
      : "baud-lamp-dim";

  const badge = branch.dispatched ? "dispatched" : branch.interactive ? "live" : null;
  const badgeClass = branch.dispatched ? "baud-badge-dispatched" : "baud-badge-live";

  const summary = branch.summary || (branch.is_citizen ? "no status reported" : "not a citizen");

  // Two ways back into a conversation: `-c` for interactive history, and
  // `--resume <id>` for a branch whose only transcripts are headless dispatch
  // runs. Either way the operator gets a resume button.
  const canResume = branch.has_history || branch.resume_id !== null;

  return (
    <article className={chipClass}>
      <header className="baud-chip-head">
        <span className={`baud-lamp ${lampClass}`} aria-hidden="true" />
        <h2 className="baud-chip-name">{branch.name}</h2>
        {badge ? <span className={`baud-badge ${badgeClass}`}>{badge}</span> : null}
      </header>

      <button
        type="button"
        className="baud-chip-summary"
        title={`${summary} - click for DASHBOARD.local.json`}
        onClick={peekDashboard}
      >
        {summary}
      </button>

      <div className="baud-chip-figures">
        <Figure
          label="mail"
          value={branch.new_mail}
          alert={branch.new_mail > 0}
          onClick={peekInbox}
        />
        <Figure label="open" value={branch.opened_mail} onClick={peekInbox} />
        <Figure label="plans" value={branch.active_plans} onClick={peekDashboard} />
        <Figure label="todos" value={branch.todo_count} onClick={peekTodos} />
      </div>

      <footer className="baud-chip-foot">
        <span className={`baud-chip-age ${age.stale ? "baud-chip-age-stale" : ""}`}>
          updated {age.label}
        </span>
        {branch.is_citizen ? (
          <span className="baud-chip-buttons">
            <button
              type="button"
              className="baud-chip-launch baud-chip-launch-quiet"
              title={`browse ${branch.path}`}
              onClick={() => onFiles(branch)}
            >
              files
            </button>
            {canResume ? (
              <button
                type="button"
                className="baud-chip-launch"
                title={
                  branch.has_history
                    ? `cd ${branch.path} and continue the claude conversation`
                    : `cd ${branch.path} and reopen the last dispatch transcript`
                }
                onClick={() => onLaunch(branch, "resume")}
              >
                ▸ resume
              </button>
            ) : null}
            <button
              type="button"
              className={`baud-chip-launch ${canResume ? "baud-chip-launch-quiet" : ""}`}
              title={`cd ${branch.path} and start a fresh claude`}
              onClick={() => onLaunch(branch, "fresh")}
            >
              {canResume ? "fresh" : "▸ claude"}
            </button>
          </span>
        ) : null}
      </footer>
    </article>
  );
}

function Figure({
  label,
  value,
  alert,
  onClick,
}: {
  label: string;
  value: number;
  alert?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`baud-figure ${alert ? "baud-figure-alert" : ""}`}
      title={`open the file behind '${label}'`}
      onClick={onClick}
    >
      <span className="baud-figure-value">{value}</span>
      <span className="baud-figure-label">{label}</span>
    </button>
  );
}
