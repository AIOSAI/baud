/**
 * THE PHONE'S OWN BACK - Android Back and the edge swipe (DPLAN-0414 wave 6,
 * item 2).
 *
 * Until this wave the face never touched browser history but for the pair
 * link's one `replaceState` (main.tsx), so the system Back on ANY screen was
 * the browser's: in the standalone PWA it left BAUD while every `‹` on screen
 * stayed inside it. Now the system Back runs the same back as the `‹` chip of
 * whatever is on top.
 *
 * TWO HALVES, both small.
 *
 * THE REGISTRY. A screen that is open says how to go back from it, by calling
 * `useSystemBack(handler)` - the very function its `‹` chip calls. The newest
 * one registered is the screen on top, because a screen registers when it
 * opens. Screens with levels of their own (the files browse's folders, the
 * inbox's message, the git app's stack, the settings sections) register
 * themselves, so Back climbs one level exactly as their chip does; the face
 * registers the rest.
 *
 * THE GUARD ENTRY. While anything is registered, history holds ONE extra entry
 * above the face's own. The system Back pops it; the guard runs the top
 * handler, and puts the entry back if something is still open. When the face
 * comes to rest by a tap instead (`‹` to the wheel, a close glyph), the
 * guard takes its entry back off with `history.back()` and ignores the pop
 * that causes. ONE entry, never one per level: a stack of entries mirrored
 * from fifteen screens would drift from them the first time a screen closed
 * without saying so, and a drifted history traps the Back key.
 *
 * ON THE WHEEL WITH NOTHING OPEN, NOTHING IS REGISTERED AND THERE IS NO
 * ENTRY: Back is the browser's, and the PWA may leave. That is the brief's
 * line, and it is deliberate - a face that swallowed Back at rest would be a
 * trap.
 *
 * The entry is pushed with no URL, so it carries the address main.tsx left
 * after it lifted the pair code: no Back ever lands on a `#pair=` link.
 */

import { useEffect, useRef } from "react";

/** The open screens' back handlers, newest last. */
export interface BackRegistry {
  /** Register a handler; the returned function unregisters it. */
  add(run: () => void): () => void;
  /** The newest handler, or null when nothing is open. */
  top(): (() => void) | null;
  /** How many screens are registered. */
  depth(): number;
  /** Be told when the registry changes; the returned function stops it. */
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

/** The face's one registry. */
export const SYSTEM_BACK = createBackRegistry();

/** The two calls of `History` the guard makes - a fake one in the tests. */
export type HistoryLike = Pick<History, "pushState" | "back">;

/** What the guard's entry carries, so it can be told from anything else. */
export const GUARD_STATE = { baud: "back" } as const;

/**
 * The guard over one history and one registry.
 *
 * `sync` makes history agree with the registry: an entry while anything is
 * open, none at rest. `popped` is the system Back: it runs the top handler -
 * unless the pop is one the guard caused itself, which it swallows.
 */
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
    /** For the tests: whether the guard believes its entry is in history. */
    armed: () => armed,
  };
}

/**
 * Register `handler` as the way back from this screen, while it is not null.
 *
 * The handler is read through a ref, so a new function each render keeps the
 * screen's PLACE in the registry: a screen re-registering on every render
 * would jump above the one opened over it.
 */
export function useSystemBack(handler: (() => void) | null, registry: BackRegistry = SYSTEM_BACK): void {
  const latest = useRef(handler);
  latest.current = handler;
  const on = handler !== null;
  useEffect(() => {
    if (!on) return;
    return registry.add(() => latest.current?.());
  }, [on, registry]);
}

/**
 * Wire the guard to the window: once, in PhoneApp.
 *
 * The sync is SCHEDULED, never immediate, and that is load-bearing. One React
 * commit that closes a screen and opens its parent (the memory screen's `‹`
 * reopening the card) unregisters one and registers the other, and in between
 * the registry is briefly empty. Syncing there would take the entry off and
 * put it straight back, and a `history.back()` followed at once by a
 * `pushState` is a race the browser settles its own way.
 */
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
      // A screen that climbed one level of its own changed nothing in the
      // registry, so nothing else would put the entry back.
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
