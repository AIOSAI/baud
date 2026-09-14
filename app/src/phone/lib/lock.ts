/**
 * THE LOCK LANE - whether the laptop's screen is locked, for the header lock
 * chip (FPLAN-0585 row 3; the monitor wheel's `machine.ts` pattern).
 *
 * WHY IT EXISTS. Patrick, 2026-09-13: *"when the laptop is unlocked that symbol
 * indicates unlocked"*. Away from home the chip is a glance that answers "did I
 * lock the laptop?" - and a tap still locks it.
 *
 * WHAT IS MEASURED, AND WHERE THE MEANING LIVES. `GET /v1/lock` is @skills'
 * `lock_state()` relayed verbatim by @api: logind's LockedHint through the same
 * graphical session the lock itself writes, GNOME's ScreenSaver as the fallback.
 * Which reader answered and what "cannot tell" is called are the skill's. This
 * file decides only which of four faces a reading means.
 *
 * UNKNOWN IS NEVER UNLOCKED. `ok: false` - the machine could not tell - and a
 * route or transport failure both draw as unknown, carrying the reason in the
 * chip's title. A green shackle is a claim, and only a reading makes it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { lockState } from "../../host";
import { HostError } from "../../host/transport.http";
import type { LockState } from "../../types";
import { whileVisible } from "./whileVisible";

/**
 * FIVE SECONDS: a lock changes rarely, and when it changes because of THIS chip
 * the tap re-reads on its own (below). The other change - Patrick unlocking at
 * the laptop - shows within five seconds of him looking back at the phone.
 */
export const LOCK_POLL_MS = 5_000;

/** The second look after a tap. `loginctl lock-session` returns before the
 *  screen has actually locked, so the read at once can still say unlocked. */
export const LOCK_SETTLE_MS = 1_000;

/** One reading, or why there is none. Both null = nothing has answered yet. */
export interface LockRead {
  state: LockState | null;
  /** The route or the wire failed - in the host's own words. */
  failure: string | null;
}

const NOT_READ: LockRead = { state: null, failure: null };

/**
 * Read the lock while the app is being looked at.
 *
 * NOTHING POLLS A POCKET (DPLAN-0305): `whileVisible` stops the interval when the
 * app goes to the background and ticks at once when it comes back - which is
 * the foreground re-read. Going away also FORGETS the reading: pulling the phone
 * out to ask "did I lock it" must not show a green from before it was pocketed,
 * so the chip is its plain self until the fresh answer lands.
 *
 * Returns the reading and `reread`, which the tap calls: once now, once
 * LOCK_SETTLE_MS later. A read asked for while one is in flight is QUEUED, not
 * dropped - a poll that left before the tap would otherwise be the last word.
 */
export function useLockState(): { read: LockRead; reread: () => void } {
  const [read, setRead] = useState<LockRead>(NOT_READ);
  /** The live effect's tick, so `reread` reaches the same single flight. */
  const tickRef = useRef<(() => void) | null>(null);
  const settle = useRef(0);

  useEffect(() => {
    let live = true;
    let busy = false;
    let again = false;

    const tick = async () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const state = await lockState();
        if (live) setRead({ state, failure: null });
      } catch (cause) {
        if (live) {
          setRead({ state: null, failure: cause instanceof HostError || cause instanceof Error ? cause.message : String(cause) });
        }
      } finally {
        busy = false;
        if (again && live) {
          again = false;
          void tick();
        }
      }
    };
    tickRef.current = () => void tick();

    const onVisibility = () => {
      if (document.visibilityState !== "visible") setRead(NOT_READ);
    };
    document.addEventListener("visibilitychange", onVisibility);
    const stop = whileVisible(() => void tick(), LOCK_POLL_MS);

    return () => {
      live = false;
      tickRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(settle.current);
      stop();
    };
  }, []);

  const reread = useCallback(() => {
    tickRef.current?.();
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => tickRef.current?.(), LOCK_SETTLE_MS);
  }, []);

  return { read, reread };
}

/**
 * Which face a reading means.
 *
 * `unread` - nothing has answered yet: the chip exactly as it was before it
 * could read anything. `unknown` - the machine could not tell, or the read
 * failed. A body where `ok` and `locked` disagree cannot come from @api, which
 * refuses them; if one ever did, it is unknown too rather than a guess.
 */
export type LockFace = "unread" | "unlocked" | "locked" | "unknown";

export function lockFace({ state, failure }: LockRead): LockFace {
  if (failure !== null) return "unknown";
  if (state === null) return "unread";
  if (state.ok && state.locked === true) return "locked";
  if (state.ok && state.locked === false) return "unlocked";
  return "unknown";
}

/** The sentence a reading carries into the chip's title, or null before any. */
export function lockLine({ state, failure }: LockRead): string | null {
  if (failure !== null) return `lock state unknown - ${failure}`;
  if (state === null) return null;
  if (state.detail) return state.detail;
  if (state.ok && state.locked !== null) return state.locked ? "the screen is locked" : "the screen is unlocked";
  return `lock state unknown${state.reason ? ` (${state.reason})` : ""}`;
}
