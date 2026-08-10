const STALE_AFTER_SECONDS = 60 * 60;

export interface RelativeAge {
  label: string;
  stale: boolean;
}

/**
 * Render an ISO-ish timestamp as a short age, e.g. "3m ago".
 * Dashboard files carry naive local timestamps, which `Date.parse` reads as
 * local time - which is exactly what we want here. Snapshot timestamps carry a
 * `Z`, which `Date.parse` reads as UTC - also what we want.
 */
export function relativeAge(timestamp: string, now: number = Date.now()): RelativeAge {
  if (!timestamp) return { label: "never", stale: true };

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return { label: "unreadable", stale: true };

  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  const stale = seconds > STALE_AFTER_SECONDS;

  if (seconds < 60) return { label: `${seconds}s ago`, stale };

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { label: `${minutes}m ago`, stale };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `${hours}h ago`, stale };

  return { label: `${Math.floor(hours / 24)}d ago`, stale };
}
