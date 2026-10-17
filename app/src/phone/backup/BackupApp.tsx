/** The backup app: the seated project's store, lane by lane, and four presses. Reference: docs/phone/backup.md */

import { useCallback, useEffect, useRef, useState } from "react";

import { backupCancel, backupJob, backupRun, backupStatus } from "../../host";
import { HostError } from "../../host/transport.http";
import type { BackupJob, BackupLane, BackupStatus } from "../../types";
import { bytesText } from "../lib/machine";
import { type Scope, scopeRefusal, screenIsAwake } from "../lib/verbs";
import { whileVisible } from "../lib/whileVisible";
import {
  BACKUP_BUTTONS,
  JOB_FORGOTTEN,
  NO_PROJECT,
  STATUS_LANES,
  backupHead,
  barFraction,
  buttonName,
  buttonPhase,
  buttonWord,
  confirmLine,
  currentTail,
  driveLine,
  laneLine,
  leavesMachine,
  outcomeView,
  progressHead,
  progressLine,
  runningJobs,
  runningVerbs,
  unregisteredLine,
} from "./backupView";

/** The contract's cadence for watching a run. */
const POLL_MS = 2000;
const IDLE_MS = 10_000;

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
  /** verb -> job id, read for the outcome once status stops listing the verb; a held verb is not re-pressable. */
  const [jobs, setJobs] = useState<Partial<Record<BackupLane, string>>>({});
  const [outcomes, setOutcomes] = useState<Partial<Record<BackupLane, Outcome>>>({});
  const [said, setSaid] = useState<string | null>(null);
  const [pending, setPending] = useState<BackupLane | null>(null);
  const [stopping, setStopping] = useState<Partial<Record<BackupLane, true>>>({});
  /** One tick at a time: a read slower than the cadence must not stack. */
  const ticking = useRef(false);
  /** The jobs map as the tick sees it: the watch outlives renders, the map does not. */
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const readStatus = useCallback(
    async (sizes = false): Promise<BackupStatus | null> => {
      if (!project) {
        setStatusSaid(NO_PROJECT);
        return null;
      }
      try {
        const answer = await backupStatus(project, sizes);
        // A plain re-read keeps sizes already walked: the cheap answer has no
        // `store` key, and dropping the numbers would un-answer a question.
        setStatus((before) => (sizes || !before?.store ? answer : { ...answer, store: before.store }));
        setStatusSaid(null);
        // A sheet opened mid-run adopts the run, so its outcome is read at the end.
        const adopted = runningJobs(answer);
        setJobs((current) => ({ ...adopted, ...current }));
        return answer;
      } catch (error) {
        setStatusSaid(sentence(error));
        return null;
      }
    },
    [project],
  );

  const busy = Object.keys(jobs).length > 0 || (status?.running?.length ?? 0) > 0;

  // whileVisible ticks at once, so this is also the read on open.
  useEffect(() => {
    if (busy) return;
    return whileVisible(() => {
      if (ticking.current) return;
      ticking.current = true;
      void readStatus().finally(() => {
        ticking.current = false;
      });
    }, IDLE_MS);
  }, [busy, readStatus]);

  const listed = runningVerbs(status);
  /** One clock per render for every elapsed time; each status read renders. */
  const now = Date.now();

  // Status is the one call carrying every lane's progress, this phone's runs or not; a job is read only
  // for a verb status no longer lists. Both are server-held facts, so a watch paused off-screen loses nothing.
  useEffect(() => {
    if (!busy) return;
    const tick = async () => {
      if (ticking.current) return;
      ticking.current = true;
      let ended = false;
      try {
        // A failed status read leaves its sentence on the sheet and lists
        // nothing, so every held job is read directly this tick instead.
        const listedNow = runningVerbs(await readStatus());
        for (const [verb, id] of Object.entries(jobsRef.current) as [BackupLane, string][]) {
          if (listedNow.includes(verb)) continue;
          try {
            const job = await backupJob(id);
            if (job.state === "running") continue;
            ended = true;
            setOutcomes((all) => ({ ...all, [verb]: { state: job.state, text: job.summary || job.error || "" } }));
            setJobs(({ [verb]: _done, ...rest }) => rest);
          } catch (error) {
            if (error instanceof HostError && error.status === 404) {
              // Restarted server: the run is a fact in the store, not here.
              ended = true;
              setOutcomes((all) => ({ ...all, [verb]: { state: "forgotten", text: JOB_FORGOTTEN } }));
              setJobs(({ [verb]: _done, ...rest }) => rest);
            } else {
              setSaid(sentence(error));
            }
          }
        }
      } finally {
        ticking.current = false;
      }
      // The lane's `last` moved when it ended: one more read shows it.
      if (ended) void readStatus();
    };
    return whileVisible(() => void tick(), POLL_MS);
  }, [busy, readStatus]);

  async function fire(lane: BackupLane) {
    setSaid(null);
    try {
      const job = await backupRun(project, lane);
      setOutcomes(({ [lane]: _old, ...rest }) => rest);
      setJobs((current) => ({ ...current, [lane]: job.job }));
    } catch (error) {
      setSaid(sentence(error));
    }
  }

  /** No confirm: stopping is the safe direction. A 404 not_running is a run that ended between two reads. */
  async function stop(verb: BackupLane) {
    setSaid(null);
    setStopping((current) => ({ ...current, [verb]: true }));
    try {
      const answer = await backupCancel(project, verb);
      setSaid(answer.message);
    } catch (error) {
      setSaid(sentence(error));
      if (error instanceof HostError && error.status === 404) void readStatus();
    } finally {
      setStopping(({ [verb]: _sent, ...rest }) => rest);
    }
  }

  function press(lane: BackupLane) {
    const phase = buttonPhase(lane, listed, Boolean(jobs[lane]), Boolean(stopping[lane]));
    if (phase === "watched" || phase === "stopping") return;
    // A read token is refused the Stop by name, exactly as it is the run.
    const refusal = !project ? NO_PROJECT : scopeRefusal(scope);
    if (refusal) {
      setSaid(`refused: ${refusal}`);
      return;
    }
    if (phase === "stop") {
      void stop(lane);
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

  const head = backupHead(project, status);

  return (
    <section className="baud-phone-reader baud-backup">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ wheel
        </button>
        <span className="baud-phone-reader-title">
          {head.name} · <b className="baud-backup-accent">BACKUP</b>
        </span>
      </header>
      {head.path ? <p className="baud-backup-root">{head.path}</p> : null}

      <div className="baud-backup-status">
        {status ? (
          <>
            {status.registered === false ? (
              <p className="baud-backup-line">{unregisteredLine(status.root)}</p>
            ) : null}
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

      {/* The other presses stay live while one runs: @backup decides what overlapping lanes mean. */}
      <div className="baud-backup-buttons">
        {BACKUP_BUTTONS.map(({ lane, label }) => {
          const phase = buttonPhase(lane, listed, Boolean(jobs[lane]), Boolean(stopping[lane]));
          const tone =
            phase === "stop" ? "baud-backup-button-stop" : phase === "idle" ? "" : "baud-backup-button-running";
          return (
            <button
              key={lane}
              type="button"
              className={`baud-backup-button ${tone}`}
              aria-disabled={phase === "watched" || phase === "stopping"}
              aria-label={buttonName(label, phase)}
              onClick={() => press(lane)}
            >
              {buttonWord(label, phase)}
            </button>
          );
        })}
      </div>

      {(status?.running ?? []).map((entry) => {
        const fraction = barFraction(entry.progress);
        const tail = currentTail(entry.progress?.current ?? null);
        return (
          <div key={`${entry.verb}:${entry.lane}:${entry.pid}`} className="baud-backup-progress">
            <p className="baud-backup-progress-head">{progressHead(entry)}</p>
            {fraction === null ? (
              <progress className="baud-backup-bar" />
            ) : (
              <progress className="baud-backup-bar" value={fraction} max={1} />
            )}
            <p className="baud-backup-progress-line">{progressLine(entry, now)}</p>
            {tail ? <p className="baud-backup-current">{tail}</p> : null}
          </div>
        );
      })}

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

      {BACKUP_BUTTONS.filter(({ lane }) => outcomes[lane]).map(({ lane, label }) => {
        const outcome = outcomes[lane] as Outcome;
        const view = outcomeView(label, outcome.state, outcome.text);
        return (
          <div key={lane} className="baud-backup-outcome">
            <p className={`baud-backup-outcome-head baud-backup-${view.tone}`}>{view.head}</p>
            {view.body ? <pre className="baud-backup-summary">{view.body}</pre> : null}
          </div>
        );
      })}
    </section>
  );
}
