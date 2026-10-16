/**
 * THE PHONE FACE'S FOUR POLLING LANES, lifted out of PhoneApp (FPLAN-0445).
 *
 * A MOVE, NOT A REWRITE. Every line below stood in `PhoneApp.tsx` an hour ago
 * and stands here unchanged; what left is 1707 lines holding four concerns, and
 * what arrived is the one concern that was always separable - each lane owns
 * state nothing else writes, which is precisely why it could come out at all.
 * Anything that read those values still reads them: the hooks hand them back.
 *
 * THE ORDER OF THE EFFECTS IS PART OF THE CONTRACT. React runs effects in the
 * order they are declared, so each hook is called in `PhoneApp` exactly where
 * its effect used to sit - the fleet before the sweep, the feed's marker reset
 * before the feed's own poll. `useFeedBadge` owns that reset for one reason and
 * no other: splitting the pair would have put a seat change and the read that
 * follows it in the wrong order for one tick.
 *
 * EVERY LANE STARTS THROUGH `whileVisible` (DPLAN-0305) - the interval stops
 * when the screen goes away and restarts with one immediate tick when it comes
 * back. That shared gate is why the four could be gathered here at all.
 */

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

/**
 * How long the git sweep waits between BRANCHES - see the lane itself below.
 *
 * The number is chosen from the far end: one full pass of a seventeen-branch
 * wheel inside a minute and a half is fresh enough for a badge, and 90s over 17
 * cards is a shade over five seconds each. It is a spacing, not a rate: the
 * cost stays one host call per this many milliseconds no matter how many agents
 * the fleet grows to, and only the time to come back round moves.
 */
export const GIT_SWEEP_MS = 5_000;

/**
 * How often the REPOSITORY's own change count is re-read - the git app's badge.
 *
 * A different lane from the sweep above and deliberately much slower. This is
 * ONE call for the whole repository rather than one per branch, so it costs
 * nothing to be timely; what it costs is a `git status` over a tree with
 * seventeen branches in it, which is the most expensive read this face makes.
 * Two minutes is well inside the scale a badge like this moves on - a repo-wide
 * count changes when somebody commits or saves, not between glances - and it
 * makes the app's number a background fact rather than a poll.
 */
export const REPO_SWEEP_MS = 120_000;

/* THE READ AND CLEARED MARKERS' KEYS LEFT THIS FILE for `./feedMarks`
   (DPLAN-0414 A#4). They were keyed per project, after the desktop bell; the
   feed they mark is machine-wide, so each is now one key on every project. */

/**
 * THE FLEET READ, and the roster that rides its tick.
 *
 * Four pieces of state that nothing outside this lane ever writes: the
 * snapshot, the snapshot's own error sentence, the cross-project roster and the
 * roster's refusal. That is the whole reason this one lifts cleanly.
 */
export function useFleetPoll(project: string, onSignOut: () => void) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The cross-project working set for the live and dispatched wheels, and the
   * reason it is missing when it is.
   *
   * A SECOND LANE, not a second copy of the fleet read: `baud --roster` is one
   * sweep over every project, which is why the wheels do not fan out over the
   * census (eleven projects would be eleven fleet reads per poll). Null is a
   * refusal, never an empty system.
   */
  const [roster, setRoster] = useState<BranchStatus[] | null>(null);
  const [rosterRefusal, setRosterRefusal] = useState<{ line: string; detail: string } | null>(null);

  const poll = useCallback(async () => {
    try {
      const next = await fleetSnapshot(project || undefined);
      setSnapshot(next);
      // The envelope carries its own failure. A snapshot that read nothing is
      // not an empty fleet, and the sentence is BAUD's own - show it verbatim.
      setError(next.error ?? null);
    } catch (cause) {
      if (cause instanceof HostError && cause.unauthorized) {
        // The token stopped working while we were using it. Do not sit on a
        // stale fleet pretending it is current.
        writeToken(null);
        onSignOut();
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }

    // The roster rides the SAME tick but its own failure. A host without the
    // route yet is a healthy host with two wheels missing, and it must not put
    // an error banner over a fleet read that worked perfectly.
    try {
      setRoster(await agentRoster());
      setRosterRefusal(null);
    } catch (cause) {
      setRoster(null);
      // A 404 here is the ROUTE not existing yet, which is a schedule, not a
      // fault - so it gets the calm word, with the whole reason as a smaller
      // line under it on the wheel (DPLAN-0414 A#14: a long-press title never
      // shows on touch). Anything else is a real failure and says so in the
      // host's own words.
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

  /* GATED ON BEING LOOKED AT (DPLAN-0305). `project` is a dependency through
     `poll`, so picking a row still refetches immediately - the wheel re-seats
     without waiting out the interval. What changed is that the interval does
     not run behind a pocketed phone, and that the first call belongs to
     `whileVisible`, which makes the same promise on every wake: what the wheel
     shows when you look at it was read when you looked. */
  useEffect(() => whileVisible(() => void poll(), POLL_MS), [poll]);

  return { snapshot, error, roster, rosterRefusal };
}

/**
 * THE PER-BRANCH CHANGED-FILE SWEEP - one branch per tick, round-robin over the
 * seated wheel.
 */
export function useGitSweep(snapshot: FleetSnapshot | null) {
  /**
   * CHANGED-FILE COUNTS FOR THE WHEEL'S BADGES - the slow lane.
   *
   * The card's own fetch is untouched and stays the exact truth: one call, for
   * the one card that was opened, at the moment it opens (AgentSheet's note on
   * it - "asking for the one card that is open costs one, when it is asked
   * for"). That ruling is about FRESHNESS and it still holds. This lane exists
   * for a different reason: a badge cannot wait for a door to open. The number
   * has to already be on the rail when the operator glances at it, or it is not
   * doing the job a badge is for.
   *
   * TWO LANES, NEVER TWO WRITERS. The sheet never reads this cache and never
   * writes it, so one number has one author on each surface - the badge's from
   * here, the card's from there. They are allowed to be a minute apart; what
   * they are not allowed to be is two sources feeding one figure, which is how
   * a face starts telling two stories about one branch.
   *
   * THE STAGGER IS THE WHOLE DESIGN. Every count is a `git status` subprocess on
   * the host, so the obvious shape - every card on every poll - is seventeen
   * subprocesses every ten seconds for numbers that move on the scale of
   * minutes. One branch per tick, round-robin over a stable order, holds the
   * cost at exactly one call per `GIT_SWEEP_MS` however big the fleet grows.
   *
   * THE SEATED PROJECT'S WHEEL, and only it. That is the wheel the face rests
   * on and the one whose whole card set belongs to the seat; the live and
   * dispatched wheels draw from the cross-project roster, and sweeping those
   * would put the sweep into projects nobody is looking at to badge cards that
   * are mostly the same agents again. A foreign card there simply carries no
   * git component - which is the same honest absence a branch waiting its turn
   * carries, and its exact count is one tap away on the card.
   */
  const [gitCounts, setGitCounts] = useState<Record<string, number>>({});
  /* THE SWEEP'S ROSTER AS ONE STRING, which is load-bearing and not tidiness.
     The poll hands down a fresh `branches` array every ten seconds, so an
     effect depending on the array would tear down and rebuild its timer on
     every tick - and a sweep that restarts every ten seconds never reaches its
     second branch. An unchanged fleet makes an identical string and the timer
     is never touched; an agent arriving or leaving is a genuinely different
     sweep and rebuilds it. */
  const sweepKey = useMemo(
    () => (snapshot?.branches ?? []).map(cardRef).join("\n"),
    [snapshot],
  );
  /* Where the sweep has got to, kept ACROSS those rebuilds. A cursor that reset
     to zero whenever the fleet changed shape would re-read the first branch
     every time and leave the tail of the wheel waiting forever. */
  const sweepAt = useRef(0);
  useEffect(() => {
    const refs = sweepKey ? sweepKey.split("\n") : [];
    if (refs.length === 0) return;
    let mounted = true;
    const step = () => {
      const ref = refs[sweepAt.current % refs.length];
      /* ADVANCED BEFORE THE CALL IS MADE, never after it. A branch with no git,
         a host that hangs, a read that refuses - none of them are the next
         branch's problem, and a cursor that waited for an answer would let one
         of them stall the whole sweep. */
      sweepAt.current += 1;
      const cut = ref.indexOf("/");
      // The NAME with its PROJECT beside it, the address every read on this
      // face takes: the transport is fenced on names, and two projects can
      // hold a same-named branch.
      /* THE COUNT LANE, not the list lane (DPLAN-0305). This badge has always
         read `result.count` and dropped the file names on the floor; asking
         through `gitChangeCount` means they are never built into an array to
         be dropped from. The request on the wire is character-for-character
         the one this sweep has always sent. */
      gitChangeCount(ref.slice(cut + 1), ref.slice(0, cut))
        .then((result) => {
          if (mounted) setGitCounts((held) => ({ ...held, [ref]: result.count }));
        })
        .catch(() => {
          /* QUIET, AND WRITES NOTHING. A branch that is not a git repo, a
             foreign serve that refused, a lane that failed - on a badge these
             are all the same answer: this component of the number is not
             known, so it is not part of the number. Nothing retries early; the
             branch waits for its slot to come round like every other one.

             WRITING NOTHING ALSO MEANS NOT UNWRITING. A branch that answered
             once and refuses now keeps its last measured count rather than
             dropping to absent, because a branch with no git never had a count
             to lose - so a refusal after a success is a blip in the lane, and
             deleting on it would blank real numbers across the whole wheel on
             one bad tick. The next slot that answers corrects it. */
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

/**
 * THE BELL'S BADGE - the feed read, its cursor, and the two markers it counts
 * against. The seat-change reset belongs to this hook and not to its caller,
 * because it has to run BEFORE the poll on the same `project` change.
 */
export function useFeedBadge(project: string) {
  /**
   * THE BELL COUNTS WHILE THE FEED IS SHUT, which is the only time a badge is
   * worth anything. FeedScreen polls its own cursor lane, but it mounts on open
   * and unmounts on close - so nothing was counting during the entire period
   * the number is for, and the bell was a bare glyph with no state at all.
   *
   * This is the desktop Bell's model, lifted a level: poll the feed, hold the
   * marker for how far the operator has read, and badge the difference. ISO
   * timestamps compare as strings, so the marker needs no Date parsing to
   * disagree with the feed's own ordering.
   *
   * WHERE IT DIVERGES FROM THE DESK, deliberately: the desktop's shade is a
   * glance, so its CLEAR button is also its read. The phone's feed is a
   * full-height screen you leave to get back to anything, so LEAVING is the
   * read - the marker moves on close, never on open, so nothing can be marked
   * read while it is still arriving behind the screen you are looking at.
   *
   * TWO MARKERS, NOT ONE, since clear landed (08-17). Read moves by itself when
   * the screen closes; CLEARED only ever moves when the operator taps clear, and
   * it is what stops an event RENDERING at all. They are held together, and the
   * badge counts past the later of them, because a badge over a screen the
   * operator emptied is the phone telling two stories about one feed.
   */
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [readUpTo, setReadUpTo] = useState("");
  const [clearedUpTo, setClearedUpTo] = useState("");

  /**
   * HOW FAR THIS BADGE HAS READ THE FEED (DPLAN-0305).
   *
   * A ref rather than state, exactly as the feed screen holds its own: the
   * cursor changes on every answer and nothing renders from it, so putting it
   * in state would re-render the whole app for a string nobody draws.
   *
   * THE FEED IS MACHINE-WIDE (DPLAN-0414 A#4). `/v1/feed` takes no project
   * and `notificationsFeed` passes none, so every seat reads the same feed
   * and the same cursor would serve them all. The cursor is still dropped
   * beside the events on a seat change (below): that costs one full window
   * read and keeps the list and its markers re-read together, and nothing
   * about the feed needs it. The markers are what used to differ per project
   * and no longer do.
   */
  const feedCursor = useRef<string | null>(null);

  /* The markers, re-read when the seat changes - and the events with them.
     The markers are MACHINE-WIDE now, one key each (`./feedMarks`), so a seat
     change reads the same values back. The seat is passed for one reason: the
     first read on a phone that has no machine-wide mark yet lifts the seated
     project's old per-project mark into it, once. */
  useEffect(() => {
    setReadUpTo(readMark(window.localStorage, "read", project));
    setClearedUpTo(readMark(window.localStorage, "cleared", project));
    setEvents([]);
    feedCursor.current = null;
  }, [project]);

  /**
   * THE BADGE'S OWN READ OF THE FEED - now with the cursor the screen beside
   * it has always had (DPLAN-0305).
   *
   * WHAT THIS WAS: `notificationsRead()`, no cursor, every ten seconds, for the
   * life of the app - which asks the server for the most recent HUNDRED events
   * in full every single time, to render a number. Measured on the live host:
   * 23,273 bytes an ask. With the cursor, a steady-state tick is 228. The
   * events themselves were never the point; the count of the ones newer than
   * the read marker is.
   *
   * THE LIST NOW ACCUMULATES INSTEAD OF BEING REPLACED, which is not a side
   * effect but the reason the cursor is safe here. Windows fold through the
   * feed's own `mergeEvents`, the same rule the screen uses, so the badge and
   * the list cannot count one feed two ways. Retention is the merge's
   * (`FEED_KEEP`), and it is a HEAD: newest first, so what a cut discards is
   * the oldest events, which are exactly the ones already below any read
   * marker.
   *
   * THE GAP FLAG IS DELIBERATELY NOT READ HERE. A window that lost events says
   * so, and that sentence belongs on the screen that can show it in words - a
   * badge has one number and no room to say "and some are missing". The screen
   * carries it, one tap away, unchanged.
   */
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
          /* A failed poll keeps the last good list AND the last good cursor.
             The badge never invents events, and the next tick retries from
             exactly where this one meant to start. */
        });
    };
    return whileVisible(refresh, POLL_MS);
  }, [project]);

  return { events, setEvents, readUpTo, setReadUpTo, clearedUpTo, setClearedUpTo };
}

/**
 * THE REPOSITORY'S OWN CHANGE COUNT - the apps layer's badge, one call a seat.
 */
export function useRepoCount(repoCitizen: string, seat: string) {
  /**
   * THE REPOSITORY'S CHANGE COUNT, per project - the git card's badge.
   *
   * KEYED BY PROJECT AND KEPT. Switching the header away and back must not
   * blank a number that was measured a minute ago and is still true; a project
   * that has never been read simply has no entry, which draws no badge.
   *
   * THIS IS NOT THE PER-BRANCH SWEEP AND MUST NOT BE JOINED TO IT. That lane
   * asks seventeen times for one branch's tracked count in the desktop's exact
   * semantics, one branch per tick, to feed seventeen card badges. This asks
   * ONCE for the whole repository, counting every changed path INCLUDING
   * untracked ones - which is the right number here for one reason: it is what
   * the changes screen actually lists, and a badge that disagrees with the list
   * it opens is worse than no badge.
   */
  const [repoCounts, setRepoCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!repoCitizen) return;
    let mounted = true;
    const read = () => {
      /* TWO NUMBERS, NOT THE ROWS THEY DESCRIBE (DPLAN-0305). This badge read
         `rows.length` and dropped the rows; `count + untracked` is the same
         number without the array, and it is the same number BY CONSTRUCTION
         rather than by coincidence - @api's builder appends every changed path
         to `rows`, increments `untracked` for the untracked ones and puts the
         rest in `files`, and `count` is `len(files)` (git_reads.py:569-602).
         Measured as well as read: 12 + 3 = 15 = len(rows), three times over on
         a live tree. Nothing here caps or filters, so the two cannot drift. */
      gitChangeCount(repoCitizen, seat, "repo")
        .then((got) => {
          if (mounted) {
            setRepoCounts((held) => ({ ...held, [seat]: got.count + got.untracked }));
          }
        })
        .catch(() => {
          /* QUIET, AND WRITES NOTHING - the sweep's own rule, for the sweep's
             own reason. No git in the tree, a refused read, a lane that failed:
             on a badge these are all "not known", and a project that answered
             once keeps its last measured number rather than dropping to absent
             on one bad tick. The card behind the badge carries the refusal in
             words when it is opened. */
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
