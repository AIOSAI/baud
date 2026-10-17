/** The phone's own Back: Android Back and the edge swipe run the `‹` of whatever screen is on top. Reference: docs/phone/settings-nav.md */

import { useEffect, useRef } from "react";

export interface BackRegistry {
  add(run: () => void): () => void;
  top(): (() => void) | null;
  depth(): number;
  subscribe(listener: () => void): () => void;
}

export function createBackRegistry(): BackRegistry {
  const entries: Array<{ run: () => void }> = [];
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((listener) => listener());
  return {
    add(run) {
      const entry = { run };
      entries.push(entry);
      tell();
      return () => {
        const at = entries.indexOf(entry);
        if (at === -1) return;
        entries.splice(at, 1);
        tell();
      };
    },
    top: () => entries[entries.length - 1]?.run ?? null,
    depth: () => entries.length,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const SYSTEM_BACK = createBackRegistry();

export type HistoryLike = Pick<History, "pushState" | "back">;

export const GUARD_STATE = { baud: "back" } as const;

// ONE history entry while anything is open, never one per level: a mirrored stack drifts from the
// screens and traps Back. At rest there is no entry, so Back is the browser's and the PWA may leave.
export function createHistoryGuard(history: HistoryLike, registry: BackRegistry) {
  let armed = false;
  let swallow = 0;
  return {
    sync() {
      const open = registry.depth() > 0;
      if (open && !armed) {
        history.pushState(GUARD_STATE, "");
        armed = true;
      } else if (!open && armed) {
        armed = false;
        swallow += 1;
        history.back();
      }
    },
    popped() {
      if (swallow > 0) {
        swallow -= 1;
        return;
      }
      // The Back key took the entry; whatever happens next, it is gone.
      armed = false;
      registry.top()?.();
    },
    armed: () => armed,
  };
}

// The handler is read through a ref: re-registering each render would jump above the screen opened over it.
export function useSystemBack(handler: (() => void) | null, registry: BackRegistry = SYSTEM_BACK): void {
  const latest = useRef(handler);
  latest.current = handler;
  const on = handler !== null;
  useEffect(() => {
    if (!on) return;
    return registry.add(() => latest.current?.());
  }, [on, registry]);
}

// The sync is scheduled, never immediate: closing a screen and opening its parent empties the registry
// for a moment, and a back() followed at once by pushState() is a race the browser settles its own way.
export function useHistoryGuard(registry: BackRegistry = SYSTEM_BACK): void {
  useEffect(() => {
    const guard = createHistoryGuard(window.history, registry);
    let queued = false;
    const later = () => {
      if (queued) return;
      queued = true;
      window.setTimeout(() => {
        queued = false;
        guard.sync();
      }, 0);
    };
    const onPop = () => {
      guard.popped();
      // Climbing a screen's own level changes nothing in the registry, so nothing else re-arms the entry.
      later();
    };
    const stop = registry.subscribe(later);
    window.addEventListener("popstate", onPop);
    later();
    return () => {
      stop();
      window.removeEventListener("popstate", onPop);
    };
  }, [registry]);
}
