/** The phone face's four polling lanes, as hooks; each starts through `whileVisible`. Reference: docs/phone/files.md */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { agentRoster, fleetSnapshot, gitChangeCount, notificationsFeed } from "../../host";
import { HostError, writeToken } from "../../host/transport.http";
import type { BranchStatus, FleetSnapshot, NotificationEvent } from "../../types";
import { cardRef } from "../FleetWheel";
import { FEED_WINDOW, mergeEvents } from "./feed";
import { readMark } from "./feedMarks";
import { whileVisible } from "./whileVisible";

/** The desktop's own middle cadence. A phone on cellular does not want 2s. */
export const POLL_MS = 10_000;

/** Spacing between branches in the git sweep: one host call per interval however big the fleet grows. */
export const GIT_SWEEP_MS = 5_000;

export const REPO_SWEEP_MS = 120_000;

export function useFleetPoll(project: string, onSignOut: () => void) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One host sweep across projects, not a fleet read each; null is a refusal, never an empty system.
  const [roster, setRoster] = useState<BranchStatus[] | null>(null);
  const [rosterRefusal, setRosterRefusal] = useState<{ line: string; detail: string } | null>(null);

  const poll = useCallback(async () => {
    try {
      const next = await fleetSnapshot(project || undefined);
      setSnapshot(next);
      setError(next.error ?? null);
    } catch (cause) {
      if (cause instanceof HostError && cause.unauthorized) {
        writeToken(null);
        onSignOut();
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }

    // The roster fails on its own: a host without the route must not banner a fleet read that worked.
    try {
      setRoster(await agentRoster());
      setRosterRefusal(null);
    } catch (cause) {
      setRoster(null);
      setRosterRefusal(
        cause instanceof HostError && cause.status === 404
          ? {
              line: "lane pending",
              detail:
                "the host serves one project per read - the cross-project roster route is not live yet",
            }
          : {
              line: "roster unavailable",
              detail: cause instanceof Error ? cause.message : String(cause),
            },
      );
    }
  }, [onSignOut, project]);

  useEffect(() => whileVisible(() => void poll(), POLL_MS), [poll]);

  return { snapshot, error, roster, rosterRefusal };
}

/** The per-branch changed-file sweep: one branch per tick, round-robin over the seated wheel only. */
export function useGitSweep(snapshot: FleetSnapshot | null) {
  // The card sheet never reads or writes these counts: one number, one author per surface.
  const [gitCounts, setGitCounts] = useState<Record<string, number>>({});
  // Keyed on a string, not the array: a fresh array each poll would rebuild the timer and never reach branch two.
  const sweepKey = useMemo(
    () => (snapshot?.branches ?? []).map(cardRef).join("\n"),
    [snapshot],
  );
  // Kept across rebuilds, or the tail of the wheel waits forever.
  const sweepAt = useRef(0);
  useEffect(() => {
    const refs = sweepKey ? sweepKey.split("\n") : [];
    if (refs.length === 0) return;
    let mounted = true;
    const step = () => {
      const ref = refs[sweepAt.current % refs.length];
      // Advanced before the call, so one hung or refusing branch cannot stall the sweep.
      sweepAt.current += 1;
      const cut = ref.indexOf("/");
      gitChangeCount(ref.slice(cut + 1), ref.slice(0, cut))
        .then((result) => {
          if (mounted) setGitCounts((held) => ({ ...held, [ref]: result.count }));
        })
        .catch(() => {
          // Writes nothing: a refusal after a success keeps the last count rather than blanking the wheel on one bad tick.
        });
    };
    const stop = whileVisible(step, GIT_SWEEP_MS);
    return () => {
      mounted = false;
      stop();
    };
  }, [sweepKey]);

  return gitCounts;
}

/** The bell's badge: the feed read, its cursor and the read/cleared markers; the seat reset must run before the poll. */
export function useFeedBadge(project: string) {
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [readUpTo, setReadUpTo] = useState("");
  const [clearedUpTo, setClearedUpTo] = useState("");

  const feedCursor = useRef<string | null>(null);

  useEffect(() => {
    setReadUpTo(readMark(window.localStorage, "read", project));
    setClearedUpTo(readMark(window.localStorage, "cleared", project));
    setEvents([]);
    feedCursor.current = null;
  }, [project]);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      notificationsFeed(feedCursor.current, FEED_WINDOW)
        .then((page) => {
          if (!mounted) return;
          feedCursor.current = page.cursor;
          setEvents((seen) => mergeEvents(seen, page.events));
        })
        .catch(() => {
          // Keeps the last good list and cursor; the next tick retries from where this one meant to start.
        });
    };
    return whileVisible(refresh, POLL_MS);
  }, [project]);

  return { events, setEvents, readUpTo, setReadUpTo, clearedUpTo, setClearedUpTo };
}

export function useRepoCount(repoCitizen: string, seat: string) {
  // Not the per-branch sweep: this counts untracked paths too, matching what the changes screen lists.
  const [repoCounts, setRepoCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!repoCitizen) return;
    let mounted = true;
    const read = () => {
      gitChangeCount(repoCitizen, seat, "repo")
        .then((got) => {
          if (mounted) {
            setRepoCounts((held) => ({ ...held, [seat]: got.count + got.untracked }));
          }
        })
        .catch(() => {
        });
    };
    const stop = whileVisible(read, REPO_SWEEP_MS);
    return () => {
      mounted = false;
      stop();
    };
  }, [repoCitizen, seat]);

  return repoCounts;
}
