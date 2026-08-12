import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { relativeAge } from "../age";
import type { NotificationEvent } from "../types";

/**
 * The notification bell, wired (m10). Desktop toasts are retired (Patrick
 * ruling 2026-08-11) - ai_mail appends every event to the project's
 * notification feed and this bell is where they land: a count badge on the
 * header, a scrollable history panel on click.
 *
 * Nothing clears itself (Patrick ruling 2026-08-11 20:45, reversing the
 * first cut's phone-shade behavior): events stay, badge and all, until the
 * operator clicks CLEAR - "I should be the only one who clears them." One
 * click wipes the lot; there is deliberately no per-row dismiss, because
 * these are glances, not an inbox - the mailbox itself is the record.
 *
 * Clearing is LOCAL: a cleared-up-to timestamp in localStorage, per
 * project. The feed file is never touched - BAUD is a reader, and the
 * feed's only writer is ai_mail. Rows click to expand: collapsed shows two
 * body lines, expanded shows everything the event carried.
 */

/** The feed only moves when mail moves - the dashboard tick's pace is fine. */
const BELL_POLL_MS = 5000;

/** How events introduce themselves: a color per kind, dim for the unknown. */
const KIND_TONES: Record<string, string> = {
  mail: "baud-bell-kind-mail",
  wake: "baud-bell-kind-wake",
  dispatch: "baud-bell-kind-dispatch",
};

interface BellProps {
  /** Seated project name - scopes the cleared-up-to marker. */
  project: string | null;
}

function clearedKey(project: string | null): string {
  return `baud-bell-cleared:${project ?? "project"}`;
}

export default function Bell({ project }: BellProps) {
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [clearedUpTo, setClearedUpTo] = useState<string>(() =>
    window.localStorage.getItem(clearedKey(project)) ?? "",
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);

  // Reseating swaps the feed AND the marker - each project keeps its own.
  useEffect(() => {
    setClearedUpTo(window.localStorage.getItem(clearedKey(project)) ?? "");
    setEvents([]);
    setExpanded(new Set());
    setOpen(false);
  }, [project]);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      invoke<NotificationEvent[]>("notifications_read")
        .then((next) => {
          if (mounted) setEvents(next);
        })
        .catch(() => {
          // A failed poll keeps the last good list - the badge never
          // invents events, and the next tick retries anyway.
        });
    };
    refresh();
    const timer = window.setInterval(refresh, BELL_POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [project]);

  // Click-away and Escape both close - the shade is a glance, not a tab.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  // ISO timestamps compare as strings - no Date parsing to disagree with
  // the feed's own ordering. Everything newer than the cleared marker is
  // live; the marker only ever moves when the operator clicks CLEAR.
  const visible = clearedUpTo
    ? events.filter((event) => event.ts > clearedUpTo)
    : events;

  const clearAll = () => {
    const newest = events.length > 0 ? events[events.length - 1].ts : "";
    if (!newest) return;
    setClearedUpTo(newest);
    window.localStorage.setItem(clearedKey(project), newest);
    setExpanded(new Set());
  };

  const toggleExpand = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="baud-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`baud-tool-btn ${visible.length > 0 ? "baud-bell-alert" : ""}`}
        title={
          visible.length > 0
            ? `${visible.length} notification(s) - yours to clear`
            : "notifications - mail and dispatch events land here, not on the desktop"
        }
        onClick={() => setOpen((current) => !current)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {visible.length > 0 ? (
          <span className="baud-bell-badge">
            {visible.length > 99 ? "99+" : visible.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="baud-bell-panel" role="dialog" aria-label="notifications">
          <header className="baud-bell-head">
            <span className="baud-bell-head-label">
              {visible.length > 0 ? `${visible.length} notification(s)` : "notifications"}
            </span>
            {visible.length > 0 ? (
              <button
                type="button"
                className="baud-bell-clear"
                title="clear every notification - one click, gone"
                onClick={clearAll}
              >
                clear
              </button>
            ) : null}
          </header>

          {visible.length === 0 ? (
            <p className="baud-bell-empty">
              all clear - mail and dispatch events fill this as the fleet works
            </p>
          ) : (
            [...visible].reverse().map((event, index) => {
              const id = `${event.ts}-${index}`;
              const isOpen = expanded.has(id);
              return (
                <article
                  className={`baud-bell-row ${isOpen ? "baud-bell-row-open" : ""}`}
                  key={id}
                  title={isOpen ? "click to collapse" : "click to read the whole thing"}
                  onClick={() => toggleExpand(id)}
                >
                  <span
                    className={`baud-bell-kind ${KIND_TONES[event.kind] ?? ""}`}
                    aria-hidden="true"
                  />
                  <div className="baud-bell-text">
                    <span className="baud-bell-title">{event.title}</span>
                    {event.body ? <span className="baud-bell-body">{event.body}</span> : null}
                  </div>
                  <span className="baud-bell-meta">
                    {event.source ? `@${event.source} · ` : ""}
                    {relativeAge(event.ts).label}
                  </span>
                </article>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
