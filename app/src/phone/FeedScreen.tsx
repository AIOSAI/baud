/**
 * The feed, full height: cursor polling, the server's gap shown, and a display-only clear.
 * Reference: docs/phone/settings-nav.md
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { relativeAge } from "../age";
import { notificationsFeed } from "../host";
import { HostError } from "../host/transport.http";
import type { NotificationEvent } from "../types";
import { FEED_WINDOW, mergeEvents } from "./lib/feed";
import { mailAddress } from "./lib/inbox";
import { onPushedEvent } from "./lib/push";
import { whileVisible } from "./lib/whileVisible";

interface FeedScreenProps {
  pollMs: number;
  /** ISO timestamp, or "" for never: at or older is hidden here and from the badge, never from the file. */
  clearedUpTo: string;
  onClear: (upTo: string) => void;
  onClose: () => void;
  /** Open the mail a row announces (rows with `mail_id` and `recipient`); `project` when the event carries it. */
  onOpenMail: (recipient: string, mailId: string, project?: string) => void;
}

export default function FeedScreen({ pollMs, clearedUpTo, onClear, onClose, onOpenMail }: FeedScreenProps) {
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

  /* Screen-scoped but still gated: a pocketed phone must not poll, and the wake tick reads at once. */
  useEffect(() => whileVisible(() => void poll(), pollMs), [poll, pollMs]);

  // Inert today; wired so the push dedupe lands at an existing call site.
  useEffect(() => {
    events.slice(0, 1).forEach(onPushedEvent);
  }, [events]);

  /* ISO timestamps compare as strings, as the merge and the desktop bell do; no Date parsing to disagree. */
  const visible = clearedUpTo ? events.filter((event) => event.ts > clearedUpTo) : events;

  /* The newest VISIBLE event: a poll landing before the tap must not be cleared unseen. */
  const clear = () => {
    if (visible.length === 0) return;
    onClear(visible[0].ts);
  };

  return (
    <section className="baud-phone-feed">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ wheel
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
      {!error && visible.length === 0 ? (
        <p className="baud-phone-empty">
          {clearedUpTo && events.length > 0
            ? "all clear — new events land here as the fleet works"
            : "nothing yet"}
        </p>
      ) : null}

      <ol className="baud-phone-events">
        {visible.map((event) => {
          const address = mailAddress(event);
          if (!address) {
            return (
              <li key={`${event.ts}/${event.title}`} className="baud-phone-event">
                <span className={`baud-phone-event-kind baud-phone-kind-${kindClass(event.kind)}`}>{event.kind}</span>
                <span className="baud-phone-event-title">{event.title}</span>
                <span className="baud-phone-event-age">{relativeAge(event.ts).label}</span>
                {event.body ? <p className="baud-phone-event-body">{event.body}</p> : null}
              </li>
            );
          }
          /* A `span` body, not `<p>`: a `<p>` may not sit inside a button. */
          return (
            <li key={`${event.ts}/${event.title}`}>
              <button
                type="button"
                className="baud-phone-event baud-phone-event-door"
                title={`open this message in ${address.recipient}'s inbox`}
                onClick={() => onOpenMail(address.recipient, address.mailId, address.project)}
              >
                <span className={`baud-phone-event-kind baud-phone-kind-${kindClass(event.kind)}`}>{event.kind}</span>
                <span className="baud-phone-event-title">{event.title}</span>
                <span className="baud-phone-event-age">{relativeAge(event.ts).label} ›</span>
                {event.body ? <span className="baud-phone-event-body">{event.body}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}


function kindClass(kind: string): string {
  return /^[a-z_]+$/.test(kind) ? kind : "other";
}
