/**
 * The feed, full height (FPLAN-0413 phase 3b).
 *
 * The desktop's bell is a shade that drops out of a header - right for a mouse
 * and a wide window, wrong for a thumb. Same events, own screen.
 *
 * CURSOR DISCIPLINE, KEPT. First contact asks with `since: null` and the server
 * answers with the most recent window rather than the whole file. Every poll
 * after that sends the cursor it was given back. The server re-delivers the
 * boundary event on purpose - at-least-once, because a dropped alert is worse
 * than a duplicate - so events are merged on their timestamp rather than
 * appended blindly.
 *
 * AND THE GAP IS SHOWN. When the feed was trimmed past what this screen had
 * seen, the server says `gap: true` and names why. That has to reach the
 * operator: a window that silently lost events looks exactly like a quiet
 * night, and those are the opposite thing.
 *
 * CLEAR IS THE OPERATOR'S, AND IT IS DISPLAY ONLY (Patrick, 08-17: "notification
 * has no clear button"). The desktop bell's model exactly: a cleared-up-to
 * timestamp, held by the face and keyed per PROJECT, and everything at or older
 * than it stops rendering. The feed file is never touched - BAUD is a reader and
 * the feed's only writer is ai_mail, so there is no host call here to make. The
 * cursor lives one level up in PhoneApp beside the unread marker, because the
 * BADGE has to obey it too: a badge counting three events over a screen that
 * shows none is the phone telling two stories about one feed.
 *
 * The button is ABSENT rather than disabled when there is nothing listed. That
 * is this face's own rule (`baud-phone-verb-refused`: "a disabled button on
 * touch has no hover, no title and no answer"), and it is the desktop bell's
 * shape as well - clear appears when there is something to clear.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { relativeAge } from "../age";
import { notificationsFeed } from "../host";
import { HostError } from "../host/transport.http";
import type { NotificationEvent } from "../types";
import { FEED_WINDOW, mergeEvents } from "./lib/feed";
import { onPushedEvent } from "./lib/push";
import { whileVisible } from "./lib/whileVisible";

interface FeedScreenProps {
  pollMs: number;
  /**
   * How far this project's feed has been CLEARED - an ISO timestamp, or "" for
   * never. Everything at or older than it is gone from this screen and from the
   * badge; nothing is gone from the file.
   */
  clearedUpTo: string;
  /** Clear: the newest timestamp currently ON SCREEN, handed up to be kept. */
  onClear: (upTo: string) => void;
  onClose: () => void;
}

export default function FeedScreen({ pollMs, clearedUpTo, onClear, onClose }: FeedScreenProps) {
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [gap, setGap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const window = await notificationsFeed(cursor.current, FEED_WINDOW);
      cursor.current = window.cursor;
      setGap(window.gap ? (window.gap_reason ?? "events were lost before this window") : null);
      setError(null);
      setEvents((seen) => mergeEvents(seen, window.events));
    } catch (cause) {
      setError(cause instanceof HostError ? cause.message : String(cause));
    }
  }, []);

  /* GATED, THE LAST LANE ON THIS FACE (DPLAN-0305 rider). This one is
     screen-scoped - it stops existing when the screen closes - so it was not
     among the four app-lifetime pollers gated first. It is still the only lane
     that can tick behind a locked phone: leave this screen open, put the phone
     in a pocket, and it asks the host for a window every ten seconds until the
     battery says otherwise.

     The wake tick matters more here than anywhere else on the face. This is the
     screen whose whole job is to be current, and a feed frozen at the moment
     the phone was pocketed is worse than a slow one - so coming back reads
     immediately, then resumes the cadence. */
  useEffect(() => whileVisible(() => void poll(), pollMs), [poll, pollMs]);

  // The push hook, wired to its own inert implementation. It does nothing today
  // and is called anyway, so the day phase 7 lands the call site already exists
  // and the dedupe question lands with it rather than after it.
  useEffect(() => {
    events.slice(0, 1).forEach(onPushedEvent);
  }, [events]);

  /* ISO timestamps compare as strings, the same way the merge sorts them and
     the same way the desktop bell filters - no Date parsing to disagree with
     the feed's own ordering. The list is newest first, so what survives the
     cursor is a head, not a tail. */
  const visible = clearedUpTo ? events.filter((event) => event.ts > clearedUpTo) : events;

  /* The newest thing the operator can actually SEE, never the newest thing this
     screen holds: a poll landing between the render and the tap must not be
     cleared by a tap that never saw it. */
  const clear = () => {
    if (visible.length === 0) return;
    onClear(visible[0].ts);
  };

  return (
    <section className="baud-phone-feed">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ back
        </button>
        <span className="baud-phone-reader-title">feed</span>
        {visible.length > 0 ? (
          <button
            type="button"
            className="baud-phone-feedclear"
            title="clear this project's notifications — display only, the feed file is never touched"
            onClick={clear}
          >
            clear
          </button>
        ) : null}
      </header>

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {gap ? <p className="baud-phone-gap">gap — {gap}</p> : null}
      {/* Two silences, and they are not the same news: a feed that has said
          nothing yet, and one the operator emptied themselves. */}
      {!error && visible.length === 0 ? (
        <p className="baud-phone-empty">
          {clearedUpTo && events.length > 0
            ? "all clear — new events land here as the fleet works"
            : "nothing yet"}
        </p>
      ) : null}

      <ol className="baud-phone-events">
        {visible.map((event) => (
          <li key={`${event.ts}/${event.title}`} className="baud-phone-event">
            <span className={`baud-phone-event-kind baud-phone-kind-${kindClass(event.kind)}`}>{event.kind}</span>
            <span className="baud-phone-event-title">{event.title}</span>
            <span className="baud-phone-event-age">{relativeAge(event.ts).label}</span>
            {event.body ? <p className="baud-phone-event-body">{event.body}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* The merge moved to `feed.ts` (DPLAN-0305) so the header's badge could take
   the same rule. It was module-private here while this screen was the only
   cursor-keeping reader; it stopped being that the day the badge got a cursor,
   and one feed folded two ways is how a badge and a list start disagreeing. */

/** Only kinds with a real colour get one; anything else stays plain. */
function kindClass(kind: string): string {
  return /^[a-z_]+$/.test(kind) ? kind : "other";
}
