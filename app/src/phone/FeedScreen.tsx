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
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { relativeAge } from "../age";
import { notificationsFeed } from "../host";
import { HostError } from "../host/transport.http";
import type { NotificationEvent } from "../types";
import { onPushedEvent } from "./push";

/** One window's worth. The server clamps its own maximum on top of this. */
const WINDOW = 100;

/** Reader-side retention, matching the desktop bell's default. */
const KEEP = 200;

interface FeedScreenProps {
  pollMs: number;
  onClose: () => void;
}

export default function FeedScreen({ pollMs, onClose }: FeedScreenProps) {
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [gap, setGap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const window = await notificationsFeed(cursor.current, WINDOW);
      cursor.current = window.cursor;
      setGap(window.gap ? (window.gap_reason ?? "events were lost before this window") : null);
      setError(null);
      setEvents((seen) => merge(seen, window.events));
    } catch (cause) {
      setError(cause instanceof HostError ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), pollMs);
    return () => window.clearInterval(timer);
  }, [poll, pollMs]);

  // The push hook, wired to its own inert implementation. It does nothing today
  // and is called anyway, so the day phase 7 lands the call site already exists
  // and the dedupe question lands with it rather than after it.
  useEffect(() => {
    events.slice(0, 1).forEach(onPushedEvent);
  }, [events]);

  return (
    <section className="baud-phone-feed">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ back
        </button>
        <span className="baud-phone-reader-title">feed</span>
      </header>

      {error ? <p className="baud-phone-error">{error}</p> : null}
      {gap ? <p className="baud-phone-gap">gap — {gap}</p> : null}
      {!error && events.length === 0 ? <p className="baud-phone-empty">nothing yet</p> : null}

      <ol className="baud-phone-events">
        {events.map((event) => (
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

/**
 * Newest first, no duplicates, capped.
 *
 * Keyed on timestamp AND title because the boundary event arrives twice by
 * design, and two different events can share a millisecond.
 */
function merge(seen: NotificationEvent[], arriving: NotificationEvent[]): NotificationEvent[] {
  const byKey = new Map(seen.map((event) => [`${event.ts}/${event.title}`, event]));
  arriving.forEach((event) => byKey.set(`${event.ts}/${event.title}`, event));
  return [...byKey.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, KEEP);
}

/** Only kinds with a real colour get one; anything else stays plain. */
function kindClass(kind: string): string {
  return /^[a-z_]+$/.test(kind) ? kind : "other";
}
