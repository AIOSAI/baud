/**
 * PLANS - what the card's PLANS tile opens (DPLAN-0414 T1, A#2).
 *
 * The tile used to open the agent's whole `DASHBOARD.local.json` in the plain
 * reader, titled "dashboard": raw JSON behind a figure that promised plans. The
 * owner's ruling (14:04, "we already do view with memories, already clean
 * read") makes the memory screen the pattern for every designed read, so this
 * is that screen's shape over the dashboard's flow section: the same file, the
 * same named-file lane, parsed here (`lib/plans.ts`), drawn as two lists. No
 * new route - @api is a gateway (compass #293).
 *
 * THE READER SHELL, as the memory screen wears it: full height, one `‹ back`,
 * sticky head, the memory screen's own list classes inside. Each list that has
 * nothing in it says so in a sentence, never a blank.
 *
 * NAMES, NEVER PATHS, and the PROJECT IS NAMED - the memory screen's reason: an
 * unnamed project resolves under the seat, which for a foreign card quietly
 * reads a same-named local agent's dashboard.
 */

import { useEffect, useRef, useState } from "react";

import { relativeAge } from "../age";
import { readFileText } from "../host";
import { NOTHING_CLOSED, NO_OPEN, type PlanRow, type Plans, plansHead, readPlans } from "./lib/plans";

/** The file behind the tile, by the name @api's fence takes. */
const PLANS_FILE = "DASHBOARD.local.json";

interface PlansScreenProps {
  /** The branch whose dashboard this is. */
  branch: string;
  /** Which project that branch lives in. Empty means the seat. */
  project: string;
  onClose: () => void;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function PlansScreen({ branch, project, onClose }: PlansScreenProps) {
  const [plans, setPlans] = useState<Plans | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Mounting IS opening, the memory screen's rule: every open re-reads, so a
  // plan closed while the screen was shut is never shown as open.
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
        // @api's own sentence, verbatim - a fence that refuses says why.
        if (alive.current) setError(message(err));
      });
  }, [branch, project]);

  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ back
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

/**
 * One list, or the sentence that stands in for it.
 *
 * A ROW IS NOT A DOOR THIS ROUND. The plan files live in the branch directory
 * and opening one in the Reader is a later row of DPLAN-0414; until then a row
 * that looked pressable would promise a read this screen cannot give, so the
 * rows are cards without a button inside.
 */
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
