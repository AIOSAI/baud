/** The PLANS tile's screen: the dashboard's flow section as two lists, in the memory screen's shell.
 * The project is always named: an unnamed one resolves under the seat and reads a same-named local agent. */

import { useEffect, useRef, useState } from "react";

import { relativeAge } from "../age";
import { readFileText } from "../host";
import { NOTHING_CLOSED, NO_OPEN, type PlanRow, type Plans, plansHead, readPlans } from "./lib/plans";

const PLANS_FILE = "DASHBOARD.local.json";

interface PlansScreenProps {
  branch: string;
  /** Which project that branch lives in. Empty means the seat. */
  project: string;
  /** The word after `‹`: where back lands, from the trail. */
  backLabel?: string;
  onClose: () => void;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function PlansScreen({ branch, project, backLabel = "back", onClose }: PlansScreenProps) {
  const [plans, setPlans] = useState<Plans | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Every open re-reads, so a plan closed while the screen was shut never shows as open.
  useEffect(() => {
    setPlans(null);
    setError(null);
    readFileText(`${branch}/${PLANS_FILE}`, project)
      .then((read) => {
        if (!alive.current) return;
        try {
          setPlans(readPlans(JSON.parse(read.content)));
        } catch (err) {
          // A malformed dashboard is the agent's news, not a BAUD fault.
          setError(`${PLANS_FILE} is not readable JSON: ${message(err)}`);
        }
      })
      .catch((err) => {
        if (alive.current) setError(message(err));
      });
  }, [branch, project]);

  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ {backLabel}
        </button>
        <span className="baud-phone-reader-title">{branch} · plans</span>
      </header>

      <div className="baud-mem-body">
        {error ? (
          <p className="baud-phone-error" role="alert">
            {error}
          </p>
        ) : plans === null ? (
          <p className="baud-phone-empty">reading…</p>
        ) : (
          <>
            <p className="baud-list-head">{plansHead(plans.active)}</p>
            <PlanList label="open" rows={plans.open} empty={NO_OPEN} />
            <PlanList label="recently closed" rows={plans.closed} empty={NOTHING_CLOSED} />
          </>
        )}
      </div>
    </section>
  );
}

// Rows carry no button: opening a plan file is not built, and a pressable row would promise it.
function PlanList({ label, rows, empty }: { label: string; rows: PlanRow[]; empty: string }) {
  return (
    <section className="baud-list-zone">
      <p className="baud-agent-zonelabel">{label.toUpperCase()}</p>
      {rows.length === 0 ? (
        <p className="baud-phone-empty">{empty}</p>
      ) : (
        <ol className="baud-mem-entries">
          {rows.map((row, index) => (
            <li key={`${row.id}-${index}`} className="baud-mem-entry">
              <span className="baud-mem-entry-head">
                {row.id ? <b>{row.id}</b> : null}
                {row.when ? <span>{relativeAge(row.when).label}</span> : null}
              </span>
              <span className="baud-mem-entry-text">{row.subject}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
