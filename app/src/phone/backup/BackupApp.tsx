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
 * Round 2 (DPLAN-0412), the owner at 06:50: "ive no way to stop it. once it
 * starts. some info would be nice, like a status bar with progress too." A
 * running press becomes Stop, and every lane in flight shows a bar, read from
 * @backup's own running files through status - so a run started from a
 * terminal or by the daemon shows, and stops, the same as one pressed here.
 *
 * A folder like git/, though it is one screen tonight: an app grows floors, and
 * the second one should not have to move the first.
 */

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
  STATUS_LANES,
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
  /** verb -> the job id whose outcome is read once status stops listing the
   *  verb. A verb in here is not re-pressable. */
  const [jobs, setJobs] = useState<Partial<Record<BackupLane, string>>>({});
  const [outcomes, setOutcomes] = useState<Partial<Record<BackupLane, Outcome>>>({});
  /** What the server said to a press: a refusal, an "already running". */
  const [said, setSaid] = useState<string | null>(null);
  const [pending, setPending] = useState<BackupLane | null>(null);
  /** Verbs whose stop has been sent and not yet answered. */
  const [stopping, setStopping] = useState<Partial<Record<BackupLane, true>>>({});
  /** One tick at a time: a read slower than the cadence must not stack. */
  const ticking = useRef(false);
  /** The jobs map as the tick sees it: the watch outlives renders, the map does not. */
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const readStatus = useCallback(
    async (sizes = false): Promise<BackupStatus | null> => {
      if (!project) return null;
      try {
        const answer = await backupStatus(project, sizes);
        // A plain re-read keeps sizes already walked: the cheap answer has no
        // `store` key, and dropping the numbers would un-answer a question.
        setStatus((before) => (sizes || !before?.store ? answer : { ...answer, store: before.store }));
        setStatusSaid(null);
        // A sheet opened mid-run adopts the run: its button reads Stop and its
        // job, when this server started it, is read for the outcome at the end.
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

  useEffect(() => {
    void readStatus();
  }, [readStatus]);

  /** Something is in flight: a job the phone holds, or a lane status lists. */
  const busy = Object.keys(jobs).length > 0 || (status?.running?.length ?? 0) > 0;
  /** The verbs status lists as running: their presses read Stop. */
  const listed = runningVerbs(status);
  /** One clock per render for every elapsed time; each status read renders. */
  const now = Date.now();

  /**
   * THE WATCH. Every 2 s while anything runs, and only while this screen is
   * looked at - nothing polls a pocket. Each tick reads STATUS, the one call
   * that carries every lane's progress, including runs this phone did not
   * start. A job is read only for a verb status no longer lists: that read is
   * the outcome, or (job still running) a lane that has not written its
   * running file yet, or `all` between two sub-lanes. Both answers are facts
   * held by the server whether or not anyone asks, so a paused watch loses
   * nothing: the next visible tick reads where it got to.
   */
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
      // 400 "already running", 400 verb_refused, 503: the server's own words.
      setSaid(sentence(error));
    }
  }

  /**
   * STOP. No confirm: stopping is the safe direction. The answer is @backup's
   * own line ("stopped drive_sync (pid 175450)"); the job closes as stopped by
   * itself and the watch reads it. A 404 not_running means the run ended
   * between two reads, so status is read again to show how things stand.
   */
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
    const refusal = !project ? "no project is seated yet" : scopeRefusal(scope);
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

      {/* THE FOUR CLICK OPTIONS, the owner's words. A lane status lists as
          running reads Stop; one the phone holds a job for but status does not
          list yet shows running and does not fire twice. The other presses stay
          live, because @backup decides what overlapping lanes mean, not this
          screen. */}
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

      {/* WHAT IS RUNNING, one block per entry in status's list: the press (and
          under Full backup the sub-lane at work), the bar, the counts, and the
          file in flight. A null progress is a lane still scanning: the bar is
          the platform's indeterminate one and the line says so. */}
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

      {/* HOW EACH RUN ENDED: the command's own last lines, verbatim. A run
          that refused before uploading anything leads with its own sentence. */}
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
