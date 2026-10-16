/**
 * THE BACKUP APP - the apps wheel's third card (DPLAN-0411). The owner,
 * 2026-10-16: "in the apps wheel in baud id like backup in there, i open the
 * card and i see my click options, i can backup from baud."
 *
 * One screen, for the seated project: what the store holds, lane by lane, and
 * the four presses that add to it. The mechanism is @backup's and the door is
 * @api's; every shape is pinned in devpulse/docs.local/backup_door_contract.md.
 * This screen composes no sentence about a run of its own: the server's words,
 * the command's summary and @backup's dates are shown as they came.
 *
 * A folder like git/, though it is one screen tonight: an app grows floors, and
 * the second one should not have to move the first.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { backupJob, backupRun, backupStatus } from "../../host";
import { HostError } from "../../host/transport.http";
import type { BackupJob, BackupLane, BackupStatus } from "../../types";
import { bytesText } from "../lib/machine";
import { type Scope, scopeRefusal, screenIsAwake } from "../lib/verbs";
import { whileVisible } from "../lib/whileVisible";
import {
  BACKUP_BUTTONS,
  JOB_FORGOTTEN,
  STATUS_LANES,
  confirmLine,
  driveLine,
  laneLine,
  leavesMachine,
  runningJobs,
} from "./backupView";

/** The contract's cadence for watching a run. */
const POLL_MS = 2000;

interface BackupAppProps {
  /** The seated project: the header chip's name, the same value GitApp gets. */
  project: string;
  /** The token's scope: a read token sees the store and cannot add to it. */
  scope: Scope;
  onClose: () => void;
}

/** How a run ended, kept per lane so two lanes' summaries never overwrite. */
interface Outcome {
  state: BackupJob["state"] | "forgotten";
  text: string;
}

function sentence(error: unknown): string {
  return error instanceof HostError ? error.message : String(error);
}

function labelOf(lane: BackupLane): string {
  return BACKUP_BUTTONS.find((button) => button.lane === lane)?.label ?? lane;
}

export default function BackupApp({ project, scope, onClose }: BackupAppProps) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  /** The status read's failure, verbatim - a 503 is the server's sentence. */
  const [statusSaid, setStatusSaid] = useState<string | null>(null);
  const [sizing, setSizing] = useState(false);
  /** lane -> the job id being watched. A lane in here is not re-pressable. */
  const [jobs, setJobs] = useState<Partial<Record<BackupLane, string>>>({});
  const [outcomes, setOutcomes] = useState<Partial<Record<BackupLane, Outcome>>>({});
  /** What the server said to a press: a refusal, an "already running". */
  const [said, setSaid] = useState<string | null>(null);
  const [pending, setPending] = useState<BackupLane | null>(null);
  /** One tick at a time: a job read slower than the cadence must not stack. */
  const ticking = useRef(false);

  const readStatus = useCallback(
    async (sizes = false) => {
      if (!project) return;
      try {
        const answer = await backupStatus(project, sizes);
        // A plain re-read keeps sizes already walked: the cheap answer has no
        // `store` key, and dropping the numbers would un-answer a question.
        setStatus((before) => (sizes || !before?.store ? answer : { ...answer, store: before.store }));
        setStatusSaid(null);
        // A sheet opened mid-run adopts the run: its button shows running and
        // its job is watched like one pressed here.
        const adopted = runningJobs(answer);
        setJobs((current) => ({ ...adopted, ...current }));
      } catch (error) {
        setStatusSaid(sentence(error));
      }
    },
    [project],
  );

  useEffect(() => {
    void readStatus();
  }, [readStatus]);

  const watching = Object.entries(jobs)
    .map(([lane, id]) => `${lane}:${id}`)
    .sort()
    .join(",");

  /**
   * THE WATCH. Every 2 s while any lane runs, and only while this screen is
   * looked at - nothing polls a pocket. A job is a fact held by the server
   * whether or not anyone asks, so a paused watch loses nothing: the next
   * visible tick reads where it got to.
   */
  useEffect(() => {
    if (!watching) return;
    const tick = async () => {
      if (ticking.current) return;
      ticking.current = true;
      let ended = false;
      try {
        for (const [lane, id] of Object.entries(jobs) as [BackupLane, string][]) {
          try {
            const job = await backupJob(id);
            if (job.state === "running") continue;
            ended = true;
            setOutcomes((all) => ({ ...all, [lane]: { state: job.state, text: job.summary || job.error || "" } }));
            setJobs(({ [lane]: _done, ...rest }) => rest);
          } catch (error) {
            if (error instanceof HostError && error.status === 404) {
              // Restarted server: the run is a fact in the store, not here.
              ended = true;
              setOutcomes((all) => ({ ...all, [lane]: { state: "forgotten", text: JOB_FORGOTTEN } }));
              setJobs(({ [lane]: _done, ...rest }) => rest);
            } else {
              setSaid(sentence(error));
            }
          }
        }
      } finally {
        ticking.current = false;
      }
      if (ended) void readStatus();
    };
    return whileVisible(() => void tick(), POLL_MS);
    // `watching` is the jobs map as a value; the map itself is a new object
    // every render and would restart the watch on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, readStatus]);

  async function fire(lane: BackupLane) {
    setSaid(null);
    try {
      const job = await backupRun(project, lane);
      setOutcomes(({ [lane]: _old, ...rest }) => rest);
      setJobs((current) => ({ ...current, [lane]: job.job }));
    } catch (error) {
      // 400 "already running", 400 verb_refused, 503: the server's own words.
      setSaid(sentence(error));
    }
  }

  function press(lane: BackupLane) {
    if (jobs[lane]) return;
    const refusal = !project ? "no project is seated yet" : scopeRefusal(scope);
    if (refusal) {
      setSaid(`refused: ${refusal}`);
      return;
    }
    if (leavesMachine(lane, status ? status.drive_sync : null)) {
      setPending(lane);
      return;
    }
    void fire(lane);
  }

  function confirm(lane: BackupLane) {
    setPending(null);
    if (!screenIsAwake()) {
      setSaid("refused: the screen slept while confirming");
      return;
    }
    void fire(lane);
  }

  async function sizes() {
    if (sizing) return;
    setSizing(true);
    await readStatus(true);
    setSizing(false);
  }

  return (
    <section className="baud-phone-reader baud-backup">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ wheel
        </button>
        <span className="baud-phone-reader-title">
          {project || "no project"} · <b className="baud-backup-accent">BACKUP</b>
        </span>
      </header>

      {/* WHAT THE STORE HOLDS, read from disk by @backup - so it survives a
          server restart that forgets every job. */}
      <div className="baud-backup-status">
        {status ? (
          <>
            {STATUS_LANES.map(({ key, label }) => (
              <p key={key} className="baud-backup-line">
                {laneLine(label, status.lanes?.[key])}
              </p>
            ))}
            <p className="baud-backup-line">{driveLine(status)}</p>
            {status.store ? (
              <p className="baud-backup-line">
                Store · snapshots {bytesText(status.store.snapshots_bytes)} · versioned{" "}
                {bytesText(status.store.versioned_bytes)}
              </p>
            ) : null}
            <button type="button" className="baud-backup-chip" onClick={() => void sizes()}>
              {sizing ? "sizes…" : "sizes"}
            </button>
          </>
        ) : statusSaid ? null : (
          <p className="baud-backup-line">reading the store…</p>
        )}
        {statusSaid ? <p className="baud-backup-said">{statusSaid}</p> : null}
      </div>

      {/* THE FOUR CLICK OPTIONS, the owner's words. A running lane shows it and
          does not fire twice; the other three stay live, because @backup's own
          locks decide what overlapping lanes mean, not this screen. */}
      <div className="baud-backup-buttons">
        {BACKUP_BUTTONS.map(({ lane, label }) => {
          const running = Boolean(jobs[lane]);
          return (
            <button
              key={lane}
              type="button"
              className={`baud-backup-button ${running ? "baud-backup-button-running" : ""}`}
              aria-disabled={running}
              onClick={() => press(lane)}
            >
              {running ? `${label} · running…` : label}
            </button>
          );
        })}
      </div>

      {said ? <p className="baud-backup-said">{said}</p> : null}

      {pending ? (
        <div className="baud-phone-confirm" role="dialog" aria-label={`confirm ${labelOf(pending)}`}>
          <p className="baud-phone-confirm-line">{confirmLine(pending, project)}</p>
          <p className="baud-phone-confirm-warn">this sends files off this machine</p>
          <div className="baud-phone-confirm-row">
            <button type="button" className="baud-phone-confirm-no" onClick={() => setPending(null)}>
              cancel
            </button>
            <button type="button" className="baud-phone-confirm-yes" onClick={() => confirm(pending)}>
              send
            </button>
          </div>
        </div>
      ) : null}

      {/* HOW EACH RUN ENDED: the command's own last lines, verbatim. */}
      {BACKUP_BUTTONS.filter(({ lane }) => outcomes[lane]).map(({ lane, label }) => {
        const outcome = outcomes[lane] as Outcome;
        return (
          <div key={lane} className="baud-backup-outcome">
            <p className={`baud-backup-outcome-head baud-backup-${outcome.state}`}>
              {label} · {outcome.state}
            </p>
            {outcome.text ? <pre className="baud-backup-summary">{outcome.text}</pre> : null}
          </div>
        );
      })}
    </section>
  );
}
