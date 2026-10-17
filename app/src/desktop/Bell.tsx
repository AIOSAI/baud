import { useEffect, useRef, useState } from "react";
import { notificationsRead } from "../host";

import { relativeAge } from "../age";
import type { NotificationEvent } from "../types";

/** The notification bell: reads ai_mail's feed, cleared only by the operator, locally. Reference: docs/desktop/rooms.md */

/** How events introduce themselves: a color per kind, dim for the unknown. */
const KIND_TONES: Record<string, string> = {
  mail: "baud-bell-kind-mail",
  wake: "baud-bell-kind-wake",
  dispatch: "baud-bell-kind-dispatch",
};

/** Synthesized, not a file: the CSP allows no external assets. */
const CHIME_NOTES: { hz: number; delay: number }[] = [
  { hz: 784, delay: 0 },
  { hz: 1046.5, delay: 0.085 },
];
const CHIME_GAIN = 0.045;
const CHIME_DECAY = 0.12;

/** One context for the app's life - browsers cap how many may exist. */
let audio: AudioContext | null = null;

function chime() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    const ctx = audio;
    // A context created before any gesture starts suspended; the operator's
    // click on the toggle is that gesture, so this resumes rather than fails.
    void ctx.resume().catch(() => {});
    const base = ctx.currentTime + 0.01;
    for (const { hz, delay } of CHIME_NOTES) {
      const start = base + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      // Exponential ramps only - a linear attack on a sine clicks.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(CHIME_GAIN, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + CHIME_DECAY);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + CHIME_DECAY + 0.02);
    }
  } catch {
    // A machine with no audio device is not a reason to break the bell.
  }
}

interface BellProps {
  /** Seated project name - scopes the cleared-up-to marker. */
  project: string | null;
  /** Feed poll cadence, from BAUD's interface settings. */
  pollMs: number;
  /** Reader-side retention: how many events this bell keeps at all. */
  maxEvents: number;
  /** Chime when a poll brings events newer than the last batch. */
  sound: boolean;
}

function clearedKey(project: string | null): string {
  return `baud-bell-cleared:${project ?? "project"}`;
}

export default function Bell({ project, pollMs, maxEvents, sound }: BellProps) {
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [clearedUpTo, setClearedUpTo] = useState<string>(() =>
    window.localStorage.getItem(clearedKey(project)) ?? "",
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);
  // The toggle, ref'd: the poll closure must see the CURRENT setting without
  // the interval being torn down and rebuilt every time it flips.
  const soundRef = useRef(sound);
  soundRef.current = sound;
  // The newest timestamp this bell has seen. `null` until the first poll
  // lands, and that first list is history, not news - it never chimes.
  const newestRef = useRef<string | null>(null);

  // Reseating swaps the feed AND the marker - each project keeps its own.
  useEffect(() => {
    setClearedUpTo(window.localStorage.getItem(clearedKey(project)) ?? "");
    setEvents([]);
    setExpanded(new Set());
    setOpen(false);
    // Another project's feed is another history: its newest event is not news.
    newestRef.current = null;
  }, [project]);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      notificationsRead()
        .then((next) => {
          if (!mounted) return;
          // Retention is reader-side: the feed file is ai_mail's alone.
          const kept = next.slice(-maxEvents);
          setEvents(kept);
          const newest = kept.length > 0 ? kept[kept.length - 1].ts : "";
          const previous = newestRef.current;
          newestRef.current = newest;
          if (previous !== null && newest > previous && soundRef.current) chime();
        })
        .catch(() => {
          // A failed poll keeps the last good list; the next tick retries.
        });
    };
    refresh();
    const timer = window.setInterval(refresh, pollMs);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [project, pollMs, maxEvents]);

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

  // ISO timestamps compare as strings, matching the feed's own ordering.
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
